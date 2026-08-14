package auth

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStoreRoundtrip(t *testing.T) {
	dir := t.TempDir()

	s, err := NewStore(dir)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	if err := s.Set("H3056", "secret-password"); err != nil {
		t.Fatalf("Set: %v", err)
	}

	// 重新打开（模拟重启），验证能从磁盘解密读回。
	s2, err := NewStore(dir)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	p, ok := s2.Get("H3056")
	if !ok || p != "secret-password" {
		t.Fatalf("Get = %q,%v, want secret-password,true", p, ok)
	}

	// 验证落盘文件不是明文。
	raw, err := os.ReadFile(filepath.Join(dir, "credentials.dat"))
	if err != nil {
		t.Fatal(err)
	}
	if contains(raw, []byte("secret-password")) {
		t.Error("落盘数据不应包含明文密码")
	}

	// 验证密钥文件权限为 0600。
	info, err := os.Stat(filepath.Join(dir, "secret.key"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("secret.key 权限 = %o, want 600", info.Mode().Perm())
	}
}

func TestStoreDelete(t *testing.T) {
	s, _ := NewStore(t.TempDir())
	_ = s.Set("A", "p1")
	_ = s.Set("B", "p2")
	if err := s.Delete("A"); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.Get("A"); ok {
		t.Error("A 应已删除")
	}
	if _, ok := s.Get("B"); !ok {
		t.Error("B 应保留")
	}
}

func contains(haystack, needle []byte) bool {
	if len(needle) == 0 {
		return true
	}
	for i := 0; i+len(needle) <= len(haystack); i++ {
		match := true
		for j := range needle {
			if haystack[i+j] != needle[j] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}
