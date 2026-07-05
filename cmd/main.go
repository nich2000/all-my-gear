package main

import (
	"fmt"
	"html/template"
	"log"
	"net/http"
	"os"

	"github.com/joho/godotenv"
)

type serverConfig struct {
	wwwDir          string
	wwwURL          string
	wwwUseSSL       bool
	certFile        string
	keyFile         string
	supabaseURL     string
	supabaseAnonKey string
}

func main() {
	err := godotenv.Load()
	if err != nil {
		// log.Fatal("Error loading .env file")
	}

	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}

	log.Fatal(runServer(cfg))
}

func loadConfig() (serverConfig, error) {
	cfg := serverConfig{
		wwwDir:          os.Getenv("WWW_DIR"),
		wwwURL:          os.Getenv("WWW_URL"),
		wwwUseSSL:       os.Getenv("WWW_USE_SSL") == "true" || os.Getenv("WWW_USE_SSL") == "1",
		supabaseURL:     os.Getenv("SUPABASE_URL"),
		supabaseAnonKey: os.Getenv("SUPABASE_ANON_KEY"),
	}

	if cfg.wwwDir == "" {
		return cfg, fmt.Errorf("WWW_DIR is empty")
	}
	if cfg.wwwURL == "" {
		return cfg, fmt.Errorf("WWW_URL is empty")
	}
	if cfg.wwwUseSSL {
		cfg.certFile = os.Getenv("CERT_FILE")
		if cfg.certFile == "" {
			return cfg, fmt.Errorf("CERT_FILE is empty")
		}
		cfg.keyFile = os.Getenv("KEY_FILE")
		if cfg.keyFile == "" {
			return cfg, fmt.Errorf("KEY_FILE is empty")
		}
	}
	if cfg.supabaseURL == "" {
		return cfg, fmt.Errorf("SUPABASE_URL is empty")
	}
	if cfg.supabaseAnonKey == "" {
		return cfg, fmt.Errorf("SUPABASE_ANON_KEY is empty")
	}

	return cfg, nil
}

func newHandler(cfg serverConfig) http.Handler {
	mux := http.NewServeMux()
	staticHandler := http.FileServer(http.Dir(cfg.wwwDir))

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/js/supabase-config.js" {
			renderSupabaseConfig(w, cfg)
			return
		}
		http.StripPrefix("/", staticHandler).ServeHTTP(w, r)
	})

	return mux
}

func runServer(cfg serverConfig) error {
	log.Printf("Server starting on %v", cfg.wwwURL)
	if cfg.wwwUseSSL {
		return http.ListenAndServeTLS(cfg.wwwURL, cfg.certFile, cfg.keyFile, newHandler(cfg))
	}
	return http.ListenAndServe(cfg.wwwURL, newHandler(cfg))
}

func renderSupabaseConfig(w http.ResponseWriter, cfg serverConfig) {
	type ConfigData struct {
		SupabaseUrl     string
		SupabaseAnonKey string
	}

	data := ConfigData{
		SupabaseUrl:     cfg.supabaseURL,
		SupabaseAnonKey: cfg.supabaseAnonKey,
	}

	tmpl, err := template.ParseFiles(cfg.wwwDir + "js/supabase-config.js")
	if err != nil {
		http.Error(w, "Template error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/javascript")
	err = tmpl.Execute(w, data)
	if err != nil {
		http.Error(w, "Template execution error", http.StatusInternalServerError)
		return
	}
}
