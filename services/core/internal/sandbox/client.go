package sandbox

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	URL, Token string
	HTTP       *http.Client
	RunLocal   func(ctx context.Context, req Request) (Outcome, error)
}

func NewClient(address, token string) *Client {
	return &Client{URL: strings.TrimSuffix(address, "/"), Token: token, HTTP: &http.Client{Timeout: 12 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

func (c *Client) Verify(ctx context.Context, req Request) (Outcome, error) {
	if c == nil || (c.URL == "" && c.RunLocal == nil) {
		return Outcome{Limitations: []string{"Verifier is not configured; remediation stays unverified."}}, nil
	}
	if c.RunLocal != nil {
		return c.RunLocal(ctx, req)
	}
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	_ = w.WriteField("original_lockfile", string(req.OriginalLockfile))
	_ = w.WriteField("original_manifest", string(req.OriginalManifest))
	_ = w.WriteField("bumped_manifest", string(req.BumpedManifest))
	_ = w.WriteField("bumped_lockfile", string(req.BumpedLockfile))
	part, err := w.CreateFormFile("project", "project.zip")
	if err != nil {
		return Outcome{}, err
	}
	if _, err = part.Write(req.Zip); err != nil {
		return Outcome{}, err
	}
	if err = w.Close(); err != nil {
		return Outcome{}, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL+"/v1/verify", &body)
	if err != nil {
		return Outcome{}, err
	}
	httpReq.Header.Set("Content-Type", w.FormDataContentType())
	if c.Token != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.Token)
	}
	resp, err := c.HTTP.Do(httpReq)
	if err != nil {
		return Outcome{Limitations: []string{"Verifier is unavailable; remediation stays unverified."}}, nil
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return Outcome{}, err
	}
	if resp.StatusCode == 422 {
		var problem struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal(b, &problem)
		if problem.Error.Message == "" {
			problem.Error.Message = "project failed verification checks"
		}
		return Outcome{}, fmt.Errorf("%s", problem.Error.Message)
	}
	if resp.StatusCode != 200 {
		return Outcome{Limitations: []string{"Verifier is unavailable; remediation stays unverified."}}, nil
	}
	var out Outcome
	if err = json.Unmarshal(b, &out); err != nil {
		return Outcome{}, err
	}
	return out, nil
}
