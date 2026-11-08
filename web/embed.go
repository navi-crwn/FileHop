// Package web holds the built browser app so the server is one binary.
// Run `npm run build` (at the repository root) before `go build`: the embed
// needs web/dist to exist.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// Dist is the content of web/dist, rooted so index.html is at "index.html".
func Dist() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err)
	}
	return sub
}
