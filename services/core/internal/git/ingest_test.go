package git

import "testing"

func TestRepositoryAllowlist(t *testing.T) {
	for _, input := range []string{"file:///etc/passwd", "https://github.com.evil.test/a/b", "https://user:pass@github.com/a/b", "http://github.com/a/b", "https://github.com/a/b?token=secret", "https://github.com/a/b/tree/main", "https://github.com/a/..", "https://127.0.0.1/a/b", "https://github.com:443/a/b"} {
		if _, err := ValidateRepository(input); err == nil {
			t.Errorf("accepted unsafe repository %q", input)
		}
	}
	for _, input := range []string{"github.com/company/project", "https://github.com/company/project.git"} {
		if _, err := ValidateRepository(input); err != nil {
			t.Fatal(err)
		}
	}
}

func TestAuthorizationHeader(t *testing.T) {
	if _, err := AuthorizationHeader("ok"); err != nil {
		t.Fatal(err)
	}
	if _, err := AuthorizationHeader("bad token"); err == nil {
		t.Fatal("accepted token with space")
	}
	if _, err := AuthorizationHeader("user:pass"); err == nil {
		t.Fatal("accepted header-injection token")
	}
}
