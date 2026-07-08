package service

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

const balanceCacheTTL = 15 * time.Second

type BalanceResult struct {
	Username   string `json:"username"`
	BalanceUSD string `json:"balanceUsd"`
}

type balanceCacheItem struct {
	checkedAt time.Time
	data      BalanceResult
}

var balanceCache = struct {
	sync.Mutex
	items map[string]balanceCacheItem
}{items: map[string]balanceCacheItem{}}

func QueryBalance(keys []string) (BalanceResult, error) {
	settings, err := repository.GetSettings()
	if err != nil {
		return BalanceResult{}, err
	}
	setting := normalizePrivateSetting(settings.Private).Balance
	if strings.TrimSpace(setting.APIURL) == "" || strings.TrimSpace(setting.Secret) == "" {
		return BalanceResult{}, safeMessageError{message: "余额接口未配置"}
	}
	keys = normalizeBalanceKeys(keys)
	if len(keys) == 0 {
		return BalanceResult{}, safeMessageError{message: "请先填写 API Key"}
	}

	cacheKey := balanceKeysHash(keys)
	if data, ok := readBalanceCache(cacheKey); ok {
		return data, nil
	}

	var lastErr error
	for _, key := range keys {
		data, err := queryUpstreamBalance(setting, key)
		if err == nil {
			writeBalanceCache(cacheKey, data)
			return data, nil
		}
		lastErr = err
	}
	if lastErr != nil {
		return BalanceResult{}, lastErr
	}
	return BalanceResult{}, safeMessageError{message: "余额查询失败"}
}

func normalizeBalanceKeys(keys []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, item := range keys {
		key := strings.TrimSpace(item)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, key)
	}
	return result
}

func queryUpstreamBalance(setting model.BalanceSetting, key string) (BalanceResult, error) {
	body, _ := json.Marshal(map[string]string{"key": key})
	request, err := http.NewRequest(http.MethodPost, setting.APIURL, bytes.NewReader(body))
	if err != nil {
		return BalanceResult{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Balance-Secret", setting.Secret)
	response, err := (&http.Client{Timeout: 15 * time.Second}).Do(request)
	if err != nil {
		return BalanceResult{}, safeMessageError{message: "余额接口连接失败"}
	}
	defer response.Body.Close()
	responseBody, _ := io.ReadAll(response.Body)
	if response.StatusCode >= http.StatusBadRequest {
		return BalanceResult{}, safeMessageError{message: "余额查询失败"}
	}

	var payload struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			User struct {
				Username   string `json:"username"`
				BalanceUSD any    `json:"balanceUsd"`
			} `json:"user"`
		} `json:"data"`
	}
	_ = json.Unmarshal(responseBody, &payload)
	if payload.Code != 0 || strings.TrimSpace(payload.Data.User.Username) == "" {
		if strings.TrimSpace(payload.Msg) != "" {
			return BalanceResult{}, safeMessageError{message: payload.Msg}
		}
		return BalanceResult{}, safeMessageError{message: "API Key 无法查询余额"}
	}
	return BalanceResult{
		Username:   strings.TrimSpace(payload.Data.User.Username),
		BalanceUSD: strings.TrimSpace(toBalanceString(payload.Data.User.BalanceUSD)),
	}, nil
}

func toBalanceString(value any) string {
	switch item := value.(type) {
	case string:
		return item
	case float64:
		return strconv.FormatFloat(item, 'f', -1, 64)
	default:
		return "0"
	}
}

func readBalanceCache(key string) (BalanceResult, bool) {
	balanceCache.Lock()
	defer balanceCache.Unlock()
	item, ok := balanceCache.items[key]
	if !ok || time.Since(item.checkedAt) > balanceCacheTTL {
		return BalanceResult{}, false
	}
	return item.data, true
}

func writeBalanceCache(key string, data BalanceResult) {
	balanceCache.Lock()
	defer balanceCache.Unlock()
	balanceCache.items[key] = balanceCacheItem{checkedAt: time.Now(), data: data}
}

func balanceKeysHash(keys []string) string {
	hash := sha256.Sum256([]byte(strings.Join(keys, "\n")))
	return hex.EncodeToString(hash[:])
}
