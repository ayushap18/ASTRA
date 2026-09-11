package scanner

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Intelligence struct {
	URL, Token string
	HTTP       *http.Client
}
type UpstreamError struct{ Status int }

func (e *UpstreamError) Error() string {
	return fmt.Sprintf("intelligence request failed with status %d", e.Status)
}
func NewIntelligence(address, token string) *Intelligence {
	return &Intelligence{URL: strings.TrimSuffix(address, "/"), Token: token, HTTP: &http.Client{Timeout: 60 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}
func (c *Intelligence) Call(ctx context.Context, route string, payload any, out any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL+route, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("intelligence service unavailable")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return &UpstreamError{Status: resp.StatusCode}
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 32*1024*1024+1))
	if err != nil {
		return err
	}
	if len(b) > 32*1024*1024 {
		return fmt.Errorf("intelligence response exceeds limit")
	}
	return json.Unmarshal(b, out)
}
func (c *Intelligence) Ready(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, "GET", c.URL+"/ready", nil)
	if err != nil {
		return err
	}
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("intelligence is not ready")
	}
	return nil
}
