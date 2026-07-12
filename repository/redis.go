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

func bytesTrimCRLF(value []byte) []byte {
	return []byte(strings.TrimRight(string(value), "\r\n"))
}
