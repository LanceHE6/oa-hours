// Package auth 提供 OA 登录凭据的本地加密存储。
//
// 凭据使用 AES-256-GCM 加密后落盘，密钥保存在独立文件（0600 权限）。
// 数据以 map[account]password 形式存储，为多用户扩展预留。
package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
)

const (
	keyFile  = "secret.key"
	dataFile = "credentials.dat"
)

// Store 是加密凭据存储。
type Store struct {
	dir string
	key []byte

	mu     sync.Mutex
	cached map[string]string // account -> password
}

// NewStore 打开（或创建）指定目录下的凭据存储。
func NewStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("创建数据目录失败: %w", err)
	}
	s := &Store{dir: dir, cached: map[string]string{}}

	keyPath := filepath.Join(dir, keyFile)
	key, err := os.ReadFile(keyPath)
	if err != nil {
		if !os.IsNotExist(err) {
			return nil, fmt.Errorf("读取密钥失败: %w", err)
		}
		// 生成新密钥并写入（0600）。
		key = make([]byte, 32)
		if _, err := rand.Read(key); err != nil {
			return nil, fmt.Errorf("生成密钥失败: %w", err)
		}
		if err := os.WriteFile(keyPath, key, 0o600); err != nil {
			return nil, fmt.Errorf("写入密钥失败: %w", err)
		}
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("密钥长度非法（应为 32 字节）")
	}
	s.key = key

	// 加载已有数据（不存在则跳过）。
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) load() error {
	dataPath := filepath.Join(s.dir, dataFile)
	raw, err := os.ReadFile(dataPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("读取凭据失败: %w", err)
	}
	plain, err := s.decrypt(raw)
	if err != nil {
		return fmt.Errorf("解密凭据失败: %w", err)
	}
	var m map[string]string
	if err := json.Unmarshal(plain, &m); err != nil {
		return fmt.Errorf("解析凭据失败: %w", err)
	}
	s.cached = m
	return nil
}

func (s *Store) persist() error {
	plain, err := json.Marshal(s.cached)
	if err != nil {
		return err
	}
	enc, err := s.encrypt(plain)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(s.dir, dataFile), enc, 0o600)
}

// Set 保存某账号的密码。
func (s *Store) Set(account, password string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cached[account] = password
	return s.persist()
}

// Get 读取某账号的密码，不存在返回 ("", false)。
func (s *Store) Get(account string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.cached[account]
	return p, ok
}

// Accounts 返回已保存的账号列表。
func (s *Store) Accounts() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]string, 0, len(s.cached))
	for a := range s.cached {
		out = append(out, a)
	}
	return out
}

// Delete 删除某账号的凭据。
func (s *Store) Delete(account string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.cached, account)
	return s.persist()
}

func (s *Store) encrypt(plain []byte) ([]byte, error) {
	block, err := aes.NewCipher(s.key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, plain, nil), nil
}

func (s *Store) decrypt(data []byte) ([]byte, error) {
	block, err := aes.NewCipher(s.key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(data) < gcm.NonceSize() {
		return nil, fmt.Errorf("密文过短")
	}
	nonce, ciphertext := data[:gcm.NonceSize()], data[gcm.NonceSize():]
	return gcm.Open(nil, nonce, ciphertext, nil)
}

var _ = base64.StdEncoding // 保留引用（密文已含 nonce 前缀，无需额外编码）
