package repository

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/basketikun/infinite-canvas/config"
)

var ErrRedisNil = errors.New("redis: nil")

var (
	redisOnce   sync.Once
	redisClient *RedisClient
	redisErr    error
)

type RedisClient struct {
	addr     string
	password string
	db       int
	pool     chan net.Conn
}

type RedisValue struct {
	Kind  byte
	Data  []byte
	Array []RedisValue
}

type RedisStreamMessage struct {
	ID     string
	Values map[string]string
}

func Redis() (*RedisClient, error) {
	redisOnce.Do(func() {
		addr := strings.TrimSpace(config.Cfg.RedisAddr)
		if addr == "" {
			redisErr = errors.New("redis addr is empty")
			return
		}
		redisClient = &RedisClient{
			addr:     addr,
			password: config.Cfg.RedisPassword,
			db:       config.Cfg.RedisDB,
			pool:     make(chan net.Conn, 512),
		}
	})
	return redisClient, redisErr
}

func (c *RedisClient) Ping(ctx context.Context) error {
	_, _, err := c.exec(ctx, "PING")
	return err
}

func (c *RedisClient) Get(ctx context.Context, key string) ([]byte, error) {
	kind, data, err := c.exec(ctx, "GET", key)
	if err != nil {
		return nil, err
	}
	if kind != '$' {
		return data, nil
	}
	return data, nil
}

func (c *RedisClient) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	args := []string{"SET", key, string(value)}
	if ttl > 0 {
		args = append(args, "PX", strconv.FormatInt(ttl.Milliseconds(), 10))
	}
	_, _, err := c.exec(ctx, args...)
	return err
}

func (c *RedisClient) SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error) {
	args := []string{"SET", key, string(value), "NX"}
	if ttl > 0 {
		args = append(args, "PX", strconv.FormatInt(ttl.Milliseconds(), 10))
	}
	kind, data, err := c.exec(ctx, args...)
	if err == ErrRedisNil {
		return false, nil
	}
	return err == nil && kind == '+' && string(data) == "OK", err
}

func (c *RedisClient) XGroupCreateMkStream(ctx context.Context, stream string, group string) error {
	_, _, err := c.exec(ctx, "XGROUP", "CREATE", stream, group, "0", "MKSTREAM")
	if err != nil && strings.Contains(strings.ToUpper(err.Error()), "BUSYGROUP") {
		return nil
	}
	return err
}

func (c *RedisClient) XAdd(ctx context.Context, stream string, fields map[string]string) (string, error) {
	args := []string{"XADD", stream, "*"}
	for key, value := range fields {
		args = append(args, key, value)
	}
	_, data, err := c.exec(ctx, args...)
	return string(data), err
}

func (c *RedisClient) XReadGroup(ctx context.Context, stream string, group string, consumer string, count int, block time.Duration) ([]RedisStreamMessage, error) {
	if count <= 0 {
		count = 1
	}
	args := []string{"XREADGROUP", "GROUP", group, consumer, "COUNT", strconv.Itoa(count), "BLOCK", strconv.FormatInt(block.Milliseconds(), 10), "STREAMS", stream, ">"}
	value, err := c.execValue(ctx, args...)
	if err == ErrRedisNil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return parseStreamMessages(value), nil
}

func (c *RedisClient) XAck(ctx context.Context, stream string, group string, ids ...string) error {
	if len(ids) == 0 {
		return nil
	}
	args := append([]string{"XACK", stream, group}, ids...)
	_, _, err := c.exec(ctx, args...)
	return err
}

func (c *RedisClient) XAutoClaim(ctx context.Context, stream string, group string, consumer string, minIdle time.Duration, start string, count int) ([]RedisStreamMessage, string, error) {
	if start == "" {
		start = "0-0"
	}
	if count <= 0 {
		count = 1
	}
	args := []string{"XAUTOCLAIM", stream, group, consumer, strconv.FormatInt(minIdle.Milliseconds(), 10), start, "COUNT", strconv.Itoa(count)}
	value, err := c.execValue(ctx, args...)
	if err == ErrRedisNil {
		return nil, start, nil
	}
	if err != nil {
		return nil, start, err
	}
	next := start
	if len(value.Array) > 0 && len(value.Array[0].Data) > 0 {
		next = string(value.Array[0].Data)
	}
	if len(value.Array) < 2 {
		return nil, next, nil
	}
	return parseClaimedStreamMessages(value.Array[1]), next, nil
}

func (c *RedisClient) execValue(ctx context.Context, args ...string) (RedisValue, error) {
	conn, err := c.getConn(ctx)
	if err != nil {
		return RedisValue{}, err
	}
	reusable := false
	defer func() {
		if reusable {
			c.putConn(conn)
			return
		}
		_ = conn.Close()
	}()

	if err := writeCommand(conn, args...); err != nil {
		return RedisValue{}, err
	}
	value, err := readValue(bufio.NewReader(conn))
	if err == nil || errors.Is(err, ErrRedisNil) {
		reusable = true
	}
	return value, err
}

func (c *RedisClient) exec(ctx context.Context, args ...string) (byte, []byte, error) {
	conn, err := c.getConn(ctx)
	if err != nil {
		return 0, nil, err
	}
	reusable := false
	defer func() {
		if reusable {
			c.putConn(conn)
			return
		}
		_ = conn.Close()
	}()

	kind, data, err := writeAndRead(conn, args...)
	if err == nil || errors.Is(err, ErrRedisNil) {
		reusable = true
	}
	return kind, data, err
}

func (c *RedisClient) getConn(ctx context.Context) (net.Conn, error) {
	select {
	case conn := <-c.pool:
		setRedisDeadline(ctx, conn)
		return conn, nil
	default:
	}
	conn, err := c.dial(ctx)
	if err != nil {
		return nil, err
	}
	if err := c.prepare(conn); err != nil {
		_ = conn.Close()
		return nil, err
	}
	return conn, nil
}

func (c *RedisClient) putConn(conn net.Conn) {
	select {
	case c.pool <- conn:
	default:
		_ = conn.Close()
	}
}

func (c *RedisClient) prepare(conn net.Conn) error {
	if c.password != "" {
		if _, _, err := writeAndRead(conn, "AUTH", c.password); err != nil {
			return err
		}
	}
	if c.db > 0 {
		if _, _, err := writeAndRead(conn, "SELECT", strconv.Itoa(c.db)); err != nil {
			return err
		}
	}
	return nil
}

func (c *RedisClient) dial(ctx context.Context) (net.Conn, error) {
	d := net.Dialer{Timeout: 3 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", c.addr)
	if err != nil {
		return nil, err
	}
	setRedisDeadline(ctx, conn)
	return conn, nil
}

func setRedisDeadline(ctx context.Context, conn net.Conn) {
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	} else {
		_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	}
}

func writeAndRead(conn net.Conn, args ...string) (byte, []byte, error) {
	if err := writeCommand(conn, args...); err != nil {
		return 0, nil, err
	}
	return readReply(bufio.NewReader(conn))
}

func writeCommand(conn net.Conn, args ...string) error {
	if _, err := fmt.Fprintf(conn, "*%d\r\n", len(args)); err != nil {
		return err
	}
	for _, arg := range args {
		if _, err := fmt.Fprintf(conn, "$%d\r\n%s\r\n", len(arg), arg); err != nil {
			return err
		}
	}
	return nil
}

func readReply(reader *bufio.Reader) (byte, []byte, error) {
	prefix, err := reader.ReadByte()
	if err != nil {
		return 0, nil, err
	}
	line, err := reader.ReadBytes('\n')
	if err != nil {
		return 0, nil, err
	}
	payload := bytesTrimCRLF(line)
	switch prefix {
	case '+', ':':
		return prefix, payload, nil
	case '$':
		if string(payload) == "-1" {
			return prefix, nil, ErrRedisNil
		}
		n, err := strconv.Atoi(string(payload))
		if err != nil {
			return 0, nil, err
		}
		buf := make([]byte, n+2)
		if _, err := io.ReadFull(reader, buf); err != nil {
			return 0, nil, err
		}
		return prefix, buf[:n], nil
	case '-':
		return 0, nil, errors.New(string(payload))
	default:
		return 0, nil, errors.New("unsupported redis response")
	}
}

func readValue(reader *bufio.Reader) (RedisValue, error) {
	prefix, err := reader.ReadByte()
	if err != nil {
		return RedisValue{}, err
	}
	line, err := reader.ReadBytes('\n')
	if err != nil {
		return RedisValue{}, err
	}
	payload := bytesTrimCRLF(line)
	switch prefix {
	case '+', ':':
		return RedisValue{Kind: prefix, Data: payload}, nil
	case '$':
		if string(payload) == "-1" {
			return RedisValue{Kind: prefix}, ErrRedisNil
		}
		n, err := strconv.Atoi(string(payload))
		if err != nil {
			return RedisValue{}, err
		}
		buf := make([]byte, n+2)
		if _, err := io.ReadFull(reader, buf); err != nil {
			return RedisValue{}, err
		}
		return RedisValue{Kind: prefix, Data: buf[:n]}, nil
	case '*':
		if string(payload) == "-1" {
			return RedisValue{Kind: prefix}, ErrRedisNil
		}
		n, err := strconv.Atoi(string(payload))
		if err != nil {
			return RedisValue{}, err
		}
		items := make([]RedisValue, 0, n)
		for i := 0; i < n; i++ {
			item, err := readValue(reader)
			if err != nil {
				return RedisValue{}, err
			}
			items = append(items, item)
		}
		return RedisValue{Kind: prefix, Array: items}, nil
	case '-':
		return RedisValue{}, errors.New(string(payload))
	default:
		return RedisValue{}, errors.New("unsupported redis response")
	}
}

func parseStreamMessages(value RedisValue) []RedisStreamMessage {
	if len(value.Array) == 0 {
		return nil
	}
	result := []RedisStreamMessage{}
	for _, streamEntry := range value.Array {
		if len(streamEntry.Array) < 2 {
			continue
		}
		messages := streamEntry.Array[1]
		for _, message := range messages.Array {
			if len(message.Array) < 2 {
				continue
			}
			fields := message.Array[1].Array
			values := map[string]string{}
			for i := 0; i+1 < len(fields); i += 2 {
				values[string(fields[i].Data)] = string(fields[i+1].Data)
			}
			result = append(result, RedisStreamMessage{ID: string(message.Array[0].Data), Values: values})
		}
	}
	return result
}

func parseClaimedStreamMessages(value RedisValue) []RedisStreamMessage {
	result := []RedisStreamMessage{}
	for _, message := range value.Array {
		if len(message.Array) < 2 {
			continue
		}
		fields := message.Array[1].Array
		values := map[string]string{}
		for i := 0; i+1 < len(fields); i += 2 {
			values[string(fields[i].Data)] = string(fields[i+1].Data)
		}
		result = append(result, RedisStreamMessage{ID: string(message.Array[0].Data), Values: values})
	}
	return result
}

func bytesTrimCRLF(value []byte) []byte {
	return []byte(strings.TrimRight(string(value), "\r\n"))
}
