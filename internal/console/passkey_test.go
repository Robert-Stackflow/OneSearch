package console

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"github.com/fxamacker/cbor/v2"
	"github.com/go-webauthn/webauthn/webauthn"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func b64(v []byte) string { return base64.RawURLEncoding.EncodeToString(v) }
func challengeValue(t *testing.T, wbody []byte) string {
	t.Helper()
	var value struct {
		Data struct {
			PublicKey struct {
				Challenge string `json:"challenge"`
			} `json:"publicKey"`
		} `json:"data"`
	}
	if json.Unmarshal(wbody, &value) != nil || value.Data.PublicKey.Challenge == "" {
		t.Fatal(string(wbody))
	}
	return value.Data.PublicKey.Challenge
}
func TestWebAuthnRegistrationAndSignedLogin(t *testing.T) {
	s := testServer(t)
	login := call(s, "POST", "/api/auth/login", `{"username":"admin","password":"test-admin-password-long"}`)
	session := login.Result().Cookies()[0]
	// Registration needs an authenticated session and device verification, not password reauthentication.
	s.store.db.Exec("UPDATE session_details SET verified_at=?", time.Now().Add(-time.Hour).Unix())
	s.store.db.Exec("INSERT INTO security(username,enabled) VALUES('admin',1)")
	if unauthenticated := call(s, "POST", "/api/passkeys/begin", `{"name":"test"}`); unauthenticated.Code != 401 {
		t.Fatal("unauthenticated passkey registration accepted")
	}
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	id := []byte("synthetic-test-credential")
	publicKey, e := cbor.Marshal(map[int]any{1: 2, 3: -7, -1: 1, -2: key.X.FillBytes(make([]byte, 32)), -3: key.Y.FillBytes(make([]byte, 32))})
	if e != nil {
		t.Fatal(e)
	}
	begin := call(s, "POST", "/api/passkeys/begin", `{"name":"test fixture"}`, session)
	if begin.Code != 200 {
		t.Fatal(begin.Body.String())
	}
	rpHash := sha256.Sum256([]byte("localhost"))
	data := append([]byte{}, rpHash[:]...)
	data = append(data, 0x45, 0, 0, 0, 0)
	data = append(data, make([]byte, 16)...)
	length := make([]byte, 2)
	binary.BigEndian.PutUint16(length, uint16(len(id)))
	data = append(data, length...)
	data = append(data, id...)
	data = append(data, publicKey...)
	attestation, _ := cbor.Marshal(map[string]any{"fmt": "none", "attStmt": map[string]any{}, "authData": data})
	client, _ := json.Marshal(map[string]any{"type": "webauthn.create", "challenge": challengeValue(t, begin.Body.Bytes()), "origin": "http://localhost:5178", "crossOrigin": false})
	body, _ := json.Marshal(map[string]any{"id": b64(id), "rawId": b64(id), "type": "public-key", "response": map[string]any{"clientDataJSON": b64(client), "attestationObject": b64(attestation), "transports": []string{"internal"}}, "clientExtensionResults": map[string]any{}})
	var stored string
	s.store.db.QueryRow("SELECT payload FROM passkey_challenges WHERE token_hash=?", hashToken(begin.Result().Cookies()[0].Value)).Scan(&stored)
	var challengeSession webauthn.SessionData
	json.Unmarshal([]byte(stored), &challengeSession)
	finish := call(s, "POST", "/api/passkeys/finish", string(body), session, begin.Result().Cookies()[0])
	if finish.Code != 200 {
		rp, _ := s.rp()
		u, _ := s.passkeyUser("admin")
		_, e := rp.FinishRegistration(u, challengeSession, httptest.NewRequest("POST", "/api/passkeys/finish", bytes.NewReader(body)))
		t.Fatal(e)
		t.Fatal(finish.Body.String())
	}
	assertion := func(origin string, count uint32, corrupt bool) (int, []*http.Cookie) {
		b := call(s, "POST", "/api/auth/passkey/begin", `{"username":"admin"}`)
		if b.Code != 200 {
			t.Fatal(b.Body.String())
		}
		client, _ := json.Marshal(map[string]any{"type": "webauthn.get", "challenge": challengeValue(t, b.Body.Bytes()), "origin": origin, "crossOrigin": false})
		authData := append([]byte{}, rpHash[:]...)
		authData = append(authData, 0x05)
		counter := make([]byte, 4)
		binary.BigEndian.PutUint32(counter, count)
		authData = append(authData, counter...)
		clientHash := sha256.Sum256(client)
		signed := append(append([]byte{}, authData...), clientHash[:]...)
		digest := sha256.Sum256(signed)
		signature, _ := ecdsa.SignASN1(rand.Reader, key, digest[:])
		if corrupt {
			signature[len(signature)-1] ^= 1
		}
		payload, _ := json.Marshal(map[string]any{"id": b64(id), "rawId": b64(id), "type": "public-key", "response": map[string]any{"clientDataJSON": b64(client), "authenticatorData": b64(authData), "signature": b64(signature), "userHandle": b64([]byte("admin"))}, "clientExtensionResults": map[string]any{}})
		w := call(s, "POST", "/api/auth/passkey/finish", string(payload), b.Result().Cookies()[0])
		return w.Code, w.Result().Cookies()
	}
	if status, _ := assertion("https://untrusted.example", 1, false); status != 401 {
		t.Fatal("wrong WebAuthn Origin accepted")
	}
	if status, _ := assertion("http://localhost:5178", 1, true); status != 401 {
		t.Fatal("invalid signature accepted")
	}
	status, cookies := assertion("http://localhost:5178", 1, false)
	if status != 200 {
		t.Fatal("valid assertion rejected", status)
	}
	var auth *http.Cookie
	for _, c := range cookies {
		if c.Name == "onesearch_session" {
			auth = c
		}
	}
	if auth == nil || call(s, "GET", "/api/auth/me", "", auth).Code != 200 {
		t.Fatal("signed login did not create valid session")
	}
	if status, _ := assertion("http://localhost:5178", 1, false); status != 401 {
		t.Fatal("non-increasing credential counter accepted")
	}
}
