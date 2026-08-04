package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadConfigRequiresRuntimeEnvironment(t *testing.T) {
	t.Setenv("WWW_DIR", "")
	t.Setenv("WWW_URL", "")
	t.Setenv("SUPABASE_URL", "")
	t.Setenv("SUPABASE_ANON_KEY", "")

	_, err := loadConfig()
	if err == nil {
		t.Fatal("expected missing environment to fail")
	}
	if !strings.Contains(err.Error(), "WWW_DIR is empty") {
		t.Fatalf("expected WWW_DIR error, got %q", err.Error())
	}
}

func TestLoadConfigRequiresTLSFilesWhenSSLIsEnabled(t *testing.T) {
	t.Setenv("WWW_DIR", "./www/")
	t.Setenv("WWW_URL", ":8080")
	t.Setenv("WWW_USE_SSL", "true")
	t.Setenv("SUPABASE_URL", "http://localhost:8000")
	t.Setenv("SUPABASE_ANON_KEY", "anon")
	t.Setenv("CERT_FILE", "")
	t.Setenv("KEY_FILE", "")

	_, err := loadConfig()
	if err == nil {
		t.Fatal("expected TLS config validation to fail")
	}
	if !strings.Contains(err.Error(), "CERT_FILE is empty") {
		t.Fatalf("expected CERT_FILE error, got %q", err.Error())
	}
}

func TestLoadConfigRequiresTLSKeyWhenSSLEnabled(t *testing.T) {
	t.Setenv("WWW_DIR", "./www/")
	t.Setenv("WWW_URL", ":8080")
	t.Setenv("WWW_USE_SSL", "1")
	t.Setenv("SUPABASE_URL", "http://localhost:8000")
	t.Setenv("SUPABASE_ANON_KEY", "anon")
	t.Setenv("CERT_FILE", "cert.pem")
	t.Setenv("KEY_FILE", "")

	_, err := loadConfig()
	if err == nil {
		t.Fatal("expected TLS key validation to fail")
	}
	if !strings.Contains(err.Error(), "KEY_FILE is empty") {
		t.Fatalf("expected KEY_FILE error, got %q", err.Error())
	}
}

func TestLoadConfigRequiresSupabaseEnvironment(t *testing.T) {
	t.Setenv("WWW_DIR", "./www/")
	t.Setenv("WWW_URL", ":8080")
	t.Setenv("WWW_USE_SSL", "false")
	t.Setenv("SUPABASE_URL", "")
	t.Setenv("SUPABASE_ANON_KEY", "")

	_, err := loadConfig()
	if err == nil {
		t.Fatal("expected Supabase URL validation to fail")
	}
	if !strings.Contains(err.Error(), "SUPABASE_URL is empty") {
		t.Fatalf("expected SUPABASE_URL error, got %q", err.Error())
	}

	t.Setenv("SUPABASE_URL", "http://localhost:8000")
	_, err = loadConfig()
	if err == nil {
		t.Fatal("expected Supabase anon key validation to fail")
	}
	if !strings.Contains(err.Error(), "SUPABASE_ANON_KEY is empty") {
		t.Fatalf("expected SUPABASE_ANON_KEY error, got %q", err.Error())
	}
}

func TestLoadConfigReturnsRuntimeConfig(t *testing.T) {
	t.Setenv("WWW_DIR", "./www/")
	t.Setenv("WWW_URL", ":8080")
	t.Setenv("WWW_USE_SSL", "false")
	t.Setenv("SUPABASE_URL", "http://localhost:8000")
	t.Setenv("SUPABASE_ANON_KEY", "anon")

	cfg, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.wwwDir != "./www/" || cfg.wwwURL != ":8080" || cfg.wwwUseSSL {
		t.Fatalf("unexpected config: %+v", cfg)
	}
	if cfg.supabaseURL != "http://localhost:8000" || cfg.supabaseAnonKey != "anon" {
		t.Fatalf("unexpected Supabase config: %+v", cfg)
	}
}

func TestNewHandlerServesStaticFilesAndRenderedSupabaseConfig(t *testing.T) {
	wwwDir := t.TempDir()
	if err := os.Mkdir(filepath.Join(wwwDir, "js"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(wwwDir, "admin"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(wwwDir, "index.html"), []byte("<!doctype html><title>All My Gear</title>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(wwwDir, "admin", "index.html"), []byte("<!doctype html><title>All My Gear — Admin</title>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(wwwDir, "js", "supabase-config.js"), []byte("const SUPABASE_URL = '{{.SupabaseUrl}}'\nconst SUPABASE_ANON_KEY = '{{.SupabaseAnonKey}}'\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	handler := newHandler(serverConfig{
		wwwDir:          wwwDir + string(os.PathSeparator),
		supabaseURL:     "http://localhost:8000",
		supabaseAnonKey: "anon-key",
	})

	staticResponse := httptest.NewRecorder()
	handler.ServeHTTP(staticResponse, httptest.NewRequest(http.MethodGet, "/", nil))
	if staticResponse.Code != http.StatusOK {
		t.Fatalf("expected static response 200, got %d", staticResponse.Code)
	}
	if !strings.Contains(staticResponse.Body.String(), "All My Gear") {
		t.Fatalf("expected index.html body, got %q", staticResponse.Body.String())
	}

	configResponse := httptest.NewRecorder()
	handler.ServeHTTP(configResponse, httptest.NewRequest(http.MethodGet, "/js/supabase-config.js", nil))
	if configResponse.Code != http.StatusOK {
		t.Fatalf("expected config response 200, got %d", configResponse.Code)
	}
	if contentType := configResponse.Header().Get("Content-Type"); contentType != "application/javascript" {
		t.Fatalf("expected javascript content type, got %q", contentType)
	}
	body := configResponse.Body.String()
	if !strings.Contains(body, "http://localhost:8000") || !strings.Contains(body, "anon-key") {
		t.Fatalf("expected rendered Supabase config, got %q", body)
	}

	adminResponse := httptest.NewRecorder()
	handler.ServeHTTP(adminResponse, httptest.NewRequest(http.MethodGet, "/admin", nil))
	if adminResponse.Code != http.StatusOK {
		t.Fatalf("expected /admin status 200, got %d", adminResponse.Code)
	}
	if !strings.Contains(adminResponse.Body.String(), "All My Gear — Admin") {
		t.Fatalf("expected admin shell, got %q", adminResponse.Body.String())
	}
	if adminResponse.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("expected admin shell to disable caching, got %q", adminResponse.Header().Get("Cache-Control"))
	}
}

func TestRunServerReturnsListenErrors(t *testing.T) {
	err := runServer(serverConfig{
		wwwDir:          t.TempDir() + string(os.PathSeparator),
		wwwURL:          "not-a-valid-address",
		supabaseURL:     "http://localhost:8000",
		supabaseAnonKey: "anon-key",
	})
	if err == nil {
		t.Fatal("expected invalid listen address to fail")
	}
}

func TestRunServerReturnsTLSErrors(t *testing.T) {
	err := runServer(serverConfig{
		wwwDir:          t.TempDir() + string(os.PathSeparator),
		wwwURL:          "127.0.0.1:0",
		wwwUseSSL:       true,
		certFile:        filepath.Join(t.TempDir(), "missing-cert.pem"),
		keyFile:         filepath.Join(t.TempDir(), "missing-key.pem"),
		supabaseURL:     "http://localhost:8000",
		supabaseAnonKey: "anon-key",
	})
	if err == nil {
		t.Fatal("expected missing TLS files to fail")
	}
}

func TestRenderSupabaseConfigReportsTemplateError(t *testing.T) {
	handler := newHandler(serverConfig{
		wwwDir:          t.TempDir() + string(os.PathSeparator),
		supabaseURL:     "http://localhost:8000",
		supabaseAnonKey: "anon-key",
	})

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/js/supabase-config.js", nil))

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("expected template error 500, got %d", response.Code)
	}
}
