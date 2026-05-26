#!/usr/bin/env python3
"""HTTP server to preview logo groups for selection."""
import http.server
import socketserver
import os

PORT = 13370
BIND = "10.9.9.20"
BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "logo")

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE, **kwargs)

    def do_GET(self):
        if self.path == "/" or self.path == "/index.html":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(build_page().encode())
        else:
            super().do_GET()

def build_page():
    groups = []
    for i in range(1, 7):
        gdir = os.path.join(BASE, "group-" + str(i))
        if os.path.isdir(gdir):
            groups.append(i)

    cb = "background-image:linear-gradient(45deg,#e0e0e0 25%,transparent 25%),linear-gradient(-45deg,#e0e0e0 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e0e0e0 75%),linear-gradient(-45deg,transparent 75%,#e0e0e0 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0;"

    light_rows = ""
    for g in groups:
        light_rows += '<div style="display:flex;align-items:center;padding:20px;border-bottom:2px solid #eee;gap:20px;">'
        light_rows += '<div style="font-size:48px;font-weight:bold;color:#666;min-width:60px;text-align:center;">' + str(g) + '</div>'
        light_rows += '<div style="' + cb + 'background-color:#fff;padding:10px;border-radius:8px;display:inline-block;"><img src="group-' + str(g) + '/icon.svg" height="80" width="80" /></div>'
        light_rows += '<div style="' + cb + 'background-color:#fff;padding:10px;border-radius:8px;display:inline-block;"><img src="group-' + str(g) + '/small-banner.svg" height="50" /></div>'
        light_rows += '<div style="' + cb + 'background-color:#fff;padding:10px;border-radius:8px;display:inline-block;"><img src="group-' + str(g) + '/full-banner.svg" height="60" /></div>'
        light_rows += '</div>'

    dark_rows = ""
    for g in groups:
        dark_rows += '<div style="display:flex;align-items:center;padding:20px;border-bottom:2px solid #333;gap:20px;">'
        dark_rows += '<div style="font-size:48px;font-weight:bold;color:#aaa;min-width:60px;text-align:center;">' + str(g) + '</div>'
        dark_rows += '<div style="background:#1a1a2e;padding:10px;border-radius:8px;display:inline-block;"><img src="group-' + str(g) + '/icon.svg" height="80" width="80" /></div>'
        dark_rows += '<div style="background:#1a1a2e;padding:10px;border-radius:8px;display:inline-block;"><img src="group-' + str(g) + '/small-banner.svg" height="50" /></div>'
        dark_rows += '<div style="background:#1a1a2e;padding:10px;border-radius:8px;display:inline-block;"><img src="group-' + str(g) + '/full-banner.svg" height="60" /></div>'
        dark_rows += '</div>'

    html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>opencode MEMnet - Logo Selection</title></head>'
    html += '<body style="font-family:system-ui,sans-serif;margin:0;padding:20px;">'
    html += '<h1 style="text-align:center;">opencode MEMnet &mdash; Logo Selection</h1>'
    html += '<p style="text-align:center;color:#666;">Pick a group number. Each row: Icon | Small Banner | Full Banner</p>'
    html += '<h2>On Light Background (checkerboard = transparent)</h2>'
    html += light_rows
    html += '<h2 style="margin-top:40px;">On Dark Background</h2>'
    html += dark_rows
    html += '</body></html>'
    return html

class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

with ReusableTCPServer((BIND, PORT), Handler) as httpd:
    print("Serving at http://" + BIND + ":" + str(PORT) + "/")
    httpd.serve_forever()
