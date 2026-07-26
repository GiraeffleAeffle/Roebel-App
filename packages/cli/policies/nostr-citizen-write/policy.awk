# Netizen strfry write policy — CitizenNFT-only writes.
# Accept an EVENT only if its author pubkey is in the Citizen allow-list.
# Reads/queries are unaffected (strfry write policy governs writes only).
# Re-reads the allow-list per event, so granting a Citizen takes effect live
# (no relay restart). Uses fflush() so strfry never blocks on a buffered pipe.
{
  line = $0
  if (!match(line, /"id":"[0-9a-fA-F]{64}"/)) next
  id = substr(line, RSTART + 6, 64)
  pk = ""
  if (match(line, /"pubkey":"[0-9a-fA-F]{64}"/)) pk = tolower(substr(line, RSTART + 10, 64))
  allowed = 0
  if (pk != "") {
    while ((getline p < "/etc/strfry/citizens.txt") > 0) {
      gsub(/[ \t\r\n]/, "", p)
      if (p != "" && substr(p, 1, 1) != "#" && tolower(p) == pk) { allowed = 1; break }
    }
    close("/etc/strfry/citizens.txt")
  }
  if (allowed)
    printf("{\"id\":\"%s\",\"action\":\"accept\"}\n", id)
  else
    printf("{\"id\":\"%s\",\"action\":\"reject\",\"msg\":\"blocked: only Roebel CitizenNFT holders may publish to this relay\"}\n", id)
  fflush()
}
