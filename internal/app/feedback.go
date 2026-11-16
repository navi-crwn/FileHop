package app

import (
	"net/url"
	"regexp"
	"strings"
)

/*
The Feedback link opens the HOP ID form in a new tab and does nothing else: this app has no form, no upload and
no route that receives anything. The address is {hub}/feedback?app=filehop&from=<screen>&v=<version>. The hub
address is the one the family announcement already uses (Config.SSOURL, only when sign-in is set up); without it
there is no link and no Privacy sentence. web/src/lib/feedback.ts builds the same address for the app itself.
*/

const feedbackApp = "filehop"

var (
	feedbackFromBad = regexp.MustCompile(`[^A-Za-z0-9._:/{}-]`)
	feedbackVerBad  = regexp.MustCompile(`[^A-Za-z0-9.+-]`)
)

// feedbackHub is the hub address the link and the Privacy sentence use: an http(s) address without a trailing
// slash, or "" (no link, no sentence). Same rule as hubBase in web/src/lib/feedback.ts.
func feedbackHub(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host + strings.TrimRight(u.Path, "/")
}

// feedbackURL is the link for one screen. The screen name is fixed per route ("home", "send", "changelog",
// "dashboard", "other"), never the address that was asked for, so no send code, id, query or fragment can reach the hub.
func feedbackURL(hub, screen, version string) string {
	base := feedbackHub(hub)
	if base == "" {
		return ""
	}
	q := url.Values{"app": {feedbackApp}}
	if from := feedbackFromBad.ReplaceAllString(screen, ""); from != "" {
		q.Set("from", feedbackTrunc(from, 80))
	}
	if v := feedbackVerBad.ReplaceAllString(version, ""); v != "" {
		q.Set("v", feedbackTrunc(v, 24))
	}
	return base + "/feedback?" + q.Encode()
}

func feedbackTrunc(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// feedbackBase is this install's hub address for the link, "" when sign-in is not set up.
func (c Config) feedbackBase() string {
	if !c.SSOEnabled() {
		return ""
	}
	return feedbackHub(c.SSOURL)
}
