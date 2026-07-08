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
	Username      string `json:"username"`
	BalanceUSD    string `json:"balanceUsd"`
	KeyName       string `json:"keyName"`
	KeyBalanceUSD string `json:"keyBalanceUsd"`
	KeyLimited    bool   `json:"keyLimited"`
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
			Username      string `json:"username"`
			BalanceUSD    any    `json:"balanceUsd"`
			KeyName       string `json:"keyName"`
			KeyBalanceUSD any    `json:"keyBalanceUsd"`
			KeyLimited    any    `json:"keyLimited"`
			User struct {
				Username   string `json:"username"`
				BalanceUSD any    `json:"balanceUsd"`
			} `json:"user"`
			Key struct {
				Name           string `json:"name"`
				KeyName        string `json:"keyName"`
				BalanceUSD     any    `json:"balanceUsd"`
				KeyBalanceUSD  any    `json:"keyBalanceUsd"`
				UnlimitedQuota any    `json:"unlimited_quota"`
				UnlimitedQuotaCamel any `json:"unlimitedQuota"`
				Unlimited      any    `json:"unlimited"`
				Limited        any    `json:"limited"`
				KeyLimited     any    `json:"keyLimited"`
			} `json:"key"`
			Token struct {
				Name           string `json:"name"`
				KeyName        string `json:"keyName"`
				BalanceUSD     any    `json:"balanceUsd"`
				KeyBalanceUSD  any    `json:"keyBalanceUsd"`
				UnlimitedQuota any    `json:"unlimited_quota"`
				UnlimitedQuotaCamel any `json:"unlimitedQuota"`
				Unlimited      any    `json:"unlimited"`
				Limited        any    `json:"limited"`
				KeyLimited     any    `json:"keyLimited"`
			} `json:"token"`
		} `json:"data"`
	}
	_ = json.Unmarshal(responseBody, &payload)
	username := firstBalanceNonEmpty(payload.Data.User.Username, payload.Data.Username)
	balanceUSD := firstBalanceNonEmpty(toBalanceString(payload.Data.User.BalanceUSD), toBalanceString(payload.Data.BalanceUSD))
	if payload.Code != 0 || username == "" {
		if strings.TrimSpace(payload.Msg) != "" {
			return BalanceResult{}, safeMessageError{message: payload.Msg}
		}
		return BalanceResult{}, safeMessageError{message: "API Key 无法查询余额"}
	}
	keyName := firstBalanceNonEmpty(payload.Data.KeyName, payload.Data.Key.KeyName, payload.Data.Key.Name, payload.Data.Token.KeyName, payload.Data.Token.Name)
	keyBalance := firstBalanceNonEmpty(toBalanceString(payload.Data.KeyBalanceUSD), toBalanceString(payload.Data.Key.KeyBalanceUSD), toBalanceString(payload.Data.Key.BalanceUSD), toBalanceString(payload.Data.Token.KeyBalanceUSD), toBalanceString(payload.Data.Token.BalanceUSD))
	unlimitedValues := []any{payload.Data.Key.UnlimitedQuota, payload.Data.Key.UnlimitedQuotaCamel, payload.Data.Key.Unlimited, payload.Data.Token.UnlimitedQuota, payload.Data.Token.UnlimitedQuotaCamel, payload.Data.Token.Unlimited}
	keyLimited := firstBool(payload.Data.KeyLimited, payload.Data.Key.KeyLimited, payload.Data.Key.Limited, payload.Data.Token.KeyLimited, payload.Data.Token.Limited) || keyBalance != "" || hasExplicitFalse(unlimitedValues...)
	if firstBool(unlimitedValues...) {
		keyLimited = false
	}
	return BalanceResult{
		Username:      strings.TrimSpace(username),
		BalanceUSD:    strings.TrimSpace(balanceUSD),
		KeyName:       strings.TrimSpace(keyName),
		KeyBalanceUSD: strings.TrimSpace(keyBalance),
		KeyLimited:    keyLimited,
	}, nil
}

func toBalanceString(value any) string {
	switch item := value.(type) {
	case string:
		return strings.TrimSpace(item)
	case float64:
		return strconv.FormatFloat(item, 'f', -1, 64)
	case int:
		return strconv.Itoa(item)
	case int64:
		return strconv.FormatInt(item, 10)
	case json.Number:
		return item.String()
	default:
		return ""
	}
}

func firstBalanceNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstBool(values ...any) bool {
	for _, value := range values {
		switch item := value.(type) {
		case bool:
			if item {
				return true
			}
		case string:
			normalized := strings.ToLower(strings.TrimSpace(item))
			if normalized == "true" || normalized == "1" || normalized == "yes" {
				return true
			}
		case float64:
			if item > 0 {
				return true
			}
		}
	}
	return false
}

func hasExplicitFalse(values ...any) bool {
	for _, value := range values {
		switch item := value.(type) {
		case bool:
			if !item {
				return true
			}
		case string:
			normalized := strings.ToLower(strings.TrimSpace(item))
			if normalized == "false" || normalized == "0" || normalized == "no" {
				return true
			}
		case float64:
			if item == 0 {
				return true
			}
		}
	}
	return false
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
