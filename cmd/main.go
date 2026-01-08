package main

import (
	"github.com/joho/godotenv"
	"html/template"
	"log"
	"net/http"
	"os"
)

var wwwDir string
var wwwURL string
var wwwUseSSL bool
var certFile string
var keyFile string
var url string
var key string

func main() {
	err := godotenv.Load()
	if err != nil {
		// log.Fatal("Error loading .env file")
	}

	wwwDir = os.Getenv("WWW_DIR")
	if wwwDir == "" {
		log.Fatal("WWW_DIR is empty")
	}

	wwwURL = os.Getenv("WWW_URL")
	if wwwURL == "" {
		log.Fatal("WWW_URL is empty")
	}

	wwwUseSSL = os.Getenv("WWW_USE_SSL") == "true" || os.Getenv("WWW_USE_SSL") == "1"

	if wwwUseSSL {
		certFile = os.Getenv("CERT_FILE")
		if certFile == "" {
			log.Fatal("CERT_FILE is empty")
		}

		keyFile = os.Getenv("KEY_FILE")
		if keyFile == "" {
			log.Fatal("KEY_FILE is empty")
		}
	}

	url = os.Getenv("SUPABASE_URL")
	if url == "" {
		log.Fatal("SUPABASE_URL is empty")
	}

	key = os.Getenv("SUPABASE_ANON_KEY")
	if key == "" {
		log.Fatal("SUPABASE_ANON_KEY is empty")
	}

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/js/supabase-config.js" {
			renderSupabaseConfig(w, r)
		} else {
			staticHandler := http.FileServer(http.Dir(wwwDir))
			http.StripPrefix("/", staticHandler).ServeHTTP(w, r)
		}
	})

	log.Printf("Server starting on %v", wwwURL)
	if wwwUseSSL {
		log.Fatal(http.ListenAndServeTLS(wwwURL, certFile, keyFile, nil))
	} else {
		log.Fatal(http.ListenAndServe(wwwURL, nil))
	}
}

func renderSupabaseConfig(w http.ResponseWriter, _ *http.Request) {
	type ConfigData struct {
		SupabaseUrl     string
		SupabaseAnonKey string
	}

	data := ConfigData{
		SupabaseUrl:     url,
		SupabaseAnonKey: key,
	}

	tmpl, err := template.ParseFiles(wwwDir + "js/supabase-config.js")
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
