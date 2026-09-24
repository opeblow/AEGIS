param(
  [string]$Base = "http://localhost:4000/api/v1"
)

$Tmp = "C:\Users\USER\Documents\AEGIS\backend\.e2e-work"
if (!(Test-Path $Tmp)) { New-Item -ItemType Directory -Path $Tmp | Out-Null }
$Curl = "C:\Windows\System32\curl.exe"
$pwd = "TestPassword!2026"

# existing run-2 accounts/ids
$orgA  = "fa965b36-4e2e-4552-85df-9a2f7da7cce9"
$orgB  = "9531f067-68ab-48e4-a662-df6c2668a9e5"
$orgC  = "c6ba4f4a-bc0d-4431-a675-c8424c28828b"  # corrected below
$uA = "aegis-a-157015205@e2e.test"
$uB = "aegis-b-909797590@e2e.test"
$uD = "aegis-d-1629693573@e2e.test"
$deal = "f50c3b86-fb49-4597-80da-44e4ba8566bc"
$runId = "eaaefd89-1ece-42b9-b5ea-d5eb0145f0ab"
$DUMMY = "00000000-0000-0000-0000-000000000000"

function BodyFile([psobject]$obj, [string]$name) {
  $p = Join-Path $Tmp "$name.json"
  $s = if ($obj -is [string]) { $obj } else { $obj | ConvertTo-Json -Depth 10 -Compress }
  Set-Content -Path $p -Value $s -NoNewline -Encoding ascii
  return $p
}

function Invoke-API {
  param([string]$Method,[string]$Path,[string]$Role,[switch]$Csf,$string]$Headers,$BodyObj,[string]$RawFile,$string]$RawCT)
  $uri = "$Base$Path"
  $args = @("-s","-S","-w","__STATUS__:%{http_code}")
  $roleArgs = @()
  if ($Role -ne "none") {
    $jar = $script:MapJar[$Role]
    $args += @("-b",$jar,"-c",$jar)
    if ($Csf) { $tk = $script:MapCsrf[$Role]; if ($tk) { $args += @("-H","x-csrf-token: $tk") } }
  }
  if ($Method -ne "GET") { $args += @("-X",$Method) }
  foreach ($h in $Headers) { $args += @("-H",$h) }
  if ($BodyObj -ne $null) {
    $bf = BodyFile $BodyObj ($Method + "_" + ($Path -replace "[^a-zA-Z0-9]", "_"))
    $args += @("-H","Content-Type: application/json","--data",$bf)
  }
  if ($RawFile) {
    if ($RawCT) { $args += @("-H","Content-Type: $RawCT") }
    $args += @("--data-binary",$RawFile)
    if ($Method -ne "GET") { $args += @("-X",$Method) }
  }
  $args += @($uri)
  $out = & $Curl @args 2>&1
  $raw = $out -join "`n"
  $st = 0; if ($raw -match "__STATUS__:(\d+)") { $st = [int]$matches[1] }
  $bodyText = $raw -replace "__STATUS__:\d+\s*$",""
  return [pscustomobject]@{ Status=$st; Body=$bodyText; Url=$uri; Method=$Method }
}

function ClassOf([int]$s) {
  if ($s -ge 200 -and $s -lt 300) { return "2xx OK" }
  if ($s -ge 300 -and $s -lt 400) { return "3xx" }
  switch ($s) {
    400 { "400 bad-request" }
    401 { "401 unauth" }
    403 { "403 forbidden" }
    404 { "404 not-found" }
    409 { "409 conflict" }
    422 { "422" }
    429 { "429 rate-limit" }
    default { if ($s -ge 500) { "5xx BUG" } else { "$s" } }
  }
}

function Probe([string]$Label,[string]$Method,[string]$Path,[string]$Role="ownerA",[switch]$Csf,[psobject]$Body,$Expect=""){
  $r = Invoke-API -Method $Method -Path $Path -Role $Role -Csf:$Csf -BodyObj $Body
  $cls = ClassOf $r.Status
  $flag = if ($r.Status -ge 500) { " <<< 5xx" } elseif ($r.Status -eq 404 -and $Path -notmatch "/$DUMMY$") { "" } else { "" }
  Write-Host ("  {0,-22} {1,-6} -> {2,3}  {3}{4}" -f $Label, $r.Method, $r.Status, $cls, $flag)
  return $r
}

# ---------- login ----------
$script:MapJar = @{}; $script:MapCsrf = @{}
function Login([string]$email,[string]$Role) {
  $jar = Join-Path $Tmp "$Role.txt"
  if (Test-Path $jar) { Remove-Item $jar -Force }
  $lr = Invoke-API -Method POST -Path "/auth/login" -Role none -BodyObj @{ email=$email; password=$pwd }
  $csrf = $null
  try { $csrf = ($lr.Body | ConvertFrom-Json -ErrorAction Stop).csrfToken } catch {}
  $script:MapJar[$Role] = $jar
  $script:MapCsrf[$Role] = $csrf
  Write-Host ("  login {0} -> {1} csrf={2}" -f $email, $lr.Status, if($csrf){"set"}else{"no"})
}
Login $uA "ownerA"
Login $uB "counterB"
Login $uD "memberD"
$uC = "aegis-c-1887628715@e2e.test"
Login $uC "outsiderC"

# ---------- real sub-resource ids ----------
# B participant id (counterparty on the deal)
$parts = Invoke-API -Method GET -Path "/deals/$deal/participants" -Role "ownerA"
$bPartId = $null
try {
  $parr = ($parts.Body | ConvertFrom-Json -ErrorAction Stop).participants
  $b = $parr | Where-Object { $_.organization?.id -eq $orgB } | Select-Object -First 1
  if ($b) { $bPartId = $b.id }
} catch {}
Write-Host "  B participantId: $bPartId"

# A sessions (for /auth/sessions + revoke)
$sess = Invoke-API -Method GET -Path "/auth/sessions" -Role "ownerA" -Csf
$aSessId = $null
try { $aList = ($sess.Body | ConvertFrom-Json -ErrorAction Stop).sessions; $aSessId = $aList[0].id } catch {}

# A members (for member revoke) -- member D
$members = Invoke-API -Method GET -Path "/organizations/$orgA/members" -Role "ownerA"
$dMemberId = $null
try {
  $marr = ($members.Body | ConvertFrom-Json -ErrorAction Stop).members
  $d = $marr | Where-Object { $_.role.name -eq "MEMBER" } | Select-Object -First 1
  if ($d) { $dMemberId = $d.id }
} catch {}

# deal invitations (B invite)
$inv = Invoke-API -Method GET -Path "/deals/$deal/invitations" -Role "ownerA" -Csf
$bInviteId = $null
try { $iarr = ($inv.Body | ConvertFrom-Json -ErrorAction Stop).invitations; $bInviteId = $iarr[0].id } catch {}

# create a document (owner) -> docId, then upload bytes
$doc = Probe "DOC-CREATE" "POST" "/deals/$deal/documents" "ownerA" -Csf -Body @{ documentType="GENERAL"; title="E2E probe doc"; visibility="PARTICIPANTS" }
$docId = $null
try { $docId = ($doc.Body | ConvertFrom-Json -ErrorAction Stop).document.id } catch {}

# png magic upload (PUT octet-stream)
if ($docId) {
  $pngFile = Join-Path $Tmp "probe.png"
  [IO.File]::WriteAllBytes($pngFile, [byte[]](0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a))
  $hdrs = @("x-original-filename: probe.png","x-mime-type: image/png")
  $upArgs = @("-s","-S","-w","__STATUS__:%{http_code}","-b",$script:MapJar["ownerA"],"-c",$script:MapJar["ownerA"],"-H","x-csrf-token: $($script:MapCsrf['ownerA'])","-X","PUT")
  foreach ($h in $hdrs) { $upArgs += @("-H",$h) }
  $upArgs += @("-H","Content-Type: application/octet-stream","--data-binary",$pngFile, "http://localhost:4000/api/v1/deals/$deal/documents/$docId/upload")
  $uo = & $Curl @upArgs 2>&1; $rawu = $uo -join "`n"; $ust=0
  if ($rawu -match "__STATUS__:(\d+)") { $ust = [int]$matches[1] }
  Write-Host ("  DOC-UPLOAD -> {0,3}  {1}" -f $ust, (ClassOf $ust))
}

# create a requirement (owner) -> reqId
$req = Probe "REQ-CREATE" "POST" "/deals/$deal/requirements" "ownerA" -Csf -Body @{ requirementType="INFORMATION"; title="E2E probe req" }
$reqId = $null
try { $reqId = ($req.Body | ConvertFrom-Json -ErrorAction Stop).requirement.id } catch {}

# create an offer (owner -> B participant) -> offerId
$offer = $null
if ($bPartId) {
  $offer = Probe "OFFER-CREATE" "POST" "/deals/$deal/offers" "ownerA" -Csf -Body @{ currency="USD"; amount="1000000.00"; price="990000.00"; recipientParticipantId=$bPartId; idempotencyKey="e2e-probe-offer-0001" }
}
$offerId = $null
try { if ($offer) { $offerId = ($offer.Body | ConvertFrom-Json -ErrorAction Stop).offer.id } } catch {}

# create an approval policy (owner) -> policyId
$pol = Probe "POL-CREATE" "POST" "/organizations/$orgA/approval-policies" "ownerA" -Csf -Body @{ name="E2E probe policy"; rules=@(@{ ruleType="NOTIONAL_THRESHOLD"; config=@{ threshold="1000000"; comparator=">="; roles=@("OWNER") } }) }
$policyId = $null
try { if ($pol) { $policyId = ($pol.Body | ConvertFrom-Json -ErrorAction Stop).policy.id } } catch {}

Write-Host "`n================ PROBE ALL ENDPOINTS ================"

# ---- HEALTH ----
Probe "H1 health"            GET "/health"                 none
Probe "H2 ready"             GET "/health/ready"           none

# ---- AUTH (no auth) ----
Probe "A register"           POST "/auth/register"         none -Body @{ email="probe-all-$(Get-Random)@e2e.test"; password="TestPassword!2026" }
Probe "A login"              POST "/auth/login"           none -Body @{ email=$uA; password=$pwd }
Probe "A verify-email"       POST "/auth/verify-email"    none -Body @{ token="invalidtoken123456789012" }
Probe "A resend-verification"POST "/auth/resend-verification" none -Body @{ email=$uA }
Probe "A forgot-password"    POST "/auth/forgot-password" none -Body @{ email=$uA }
Probe "A reset-password"     POST "/auth/reset-password"  none -Body @{ token="invalidtoken123456789012"; password="NewPass1234567!" }
Probe "A change-password"    POST "/auth/change-password" ownerA -Csf -Body @{ currentPassword=$pwd; password="NewPass1234567!" }
$null = Probe "A logout"     POST "/auth/logout"          ownerA -Csf
# re-login after logout
Login $uA "ownerA"

# ---- AUTH (authed) ----
Probe "A me"                 GET  "/auth/me"              ownerA
Probe "A sessions"           GET  "/auth/sessions"        ownerA -Csf
Probe "A revoke session"     DELETE "/auth/sessions/$DUMMY" ownerA -Csf
Probe "A logout-all"         POST "/auth/logout-all"      ownerA -Csf
Probe "A dev mailbox"        GET  "/auth/dev/mailbox"     ownerA
Probe "A dev mailbox tokens" GET  "/auth/dev/mailbox/tokens" ownerA
$null = Probe "A dev mailbox del" DELETE "/auth/dev/mailbox" ownerA

# ---- ORGANIZATIONS ----
Probe "ORG list"             GET  "/organizations"        ownerA
Probe "ORG get"              GET  "/organizations/$orgA"   ownerA
Probe "ORG list members"     GET  "/organizations/$orgA/members" ownerA
Probe "ORG get D member"     GET  "/organizations/$orgA/members/$dMemberId" ownerA
Probe "ORG patch member"     PATCH "/organizations/$orgA/members/$dMemberId" ownerA -Csf -Body @{ status="ACTIVE" }
Probe "ORG patch member role"PATCH "/organizations/$orgA/members/$dMemberId/role" ownerA -Csf -Body @{ role="VIEWER" }
Probe "ORG transfer ownership" POST "/organizations/$orgA/ownership/transfer" ownerA -Csf -Body @{ memberId=$dMemberId }
Probe "ORG remove member"    DELETE "/organizations/$orgA/members/$dMemberId" ownerA -Csf
Probe "ORG create invite"    POST "/organizations/$orgA/invitations" ownerA -Csf -Body @{ email="invite-probe-$(Get-Random)@e2e.test"; role="MEMBER" }
Probe "ORG revoke invite"    POST "/organizations/$orgA/invitations/$DUMMY/revoke" ownerA -Csf
Probe "ORG invite lookup"    GET  "/invitations/$DUMMY"            none
Probe "ORG accept invite"    POST "/invitations/$DUMMY/accept"    memberD -Csf -Body @{}
Probe "ORG roles"            GET  "/organizations/$orgA/roles"     ownerA
Probe "ORG security-events"  GET  "/organizations/$orgA/security-events?limit=5" ownerA

# ---- DEALS ----
Probe "DEAL list"            GET  "/organizations/$orgA/deals" ownerA
Probe "DEAL get"             GET  "/organizations/$orgA/deals/$deal" ownerA
Probe "DEAL history"         GET  "/organizations/$orgA/deals/$deal/history" ownerA
Probe "DEAL patch"           PATCH "/organizations/$orgA/deals/$deal" ownerA -Csf -Body @{ name="E2E probe deal renamed" }
Probe "DEAL transition"      POST "/organizations/$orgA/deals/$deal/transitions" ownerA -Csf -Body @{ to="OPEN"; reason="probe" }

# ---- COUNTERPARTIES ----
Probe "CPTY list"            GET  "/organizations/$orgB/counterparties" counterB
Probe "CPTY get"             GET  "/organizations/$orgB/counterparties/$DUMMY" counterB
Probe "CPTY create"          POST "/organizations/$orgB/counterparties" counterB -Csf -Body @{ name="Probe CPTY"; type="ORGANIZATION"; legalName="Probe CPTY Ltd"; country="US"; address="1 Main St"; contactEmail="probe@e2e.test" }
Probe "CPTY update"          PATCH "/organizations/$orgB/counterparties/$DUMMY" counterB -Csf -Body @{ name="Updated" }
Probe "CPTY delete"          DELETE "/organizations/$orgB/counterparties/$DUMMY" counterB -Csf

# ---- PARTICIPANTS / INVITES / ROOM ----
Probe "DEAL participants"    GET  "/deals/$deal/participants" ownerA
Probe "DEAL participant get" GET  "/deals/$deal/participants/$DUMMY" ownerA
Probe "DEAL participant patch" PATCH "/deals/$deal/participants/$DUMMY/status" ownerA -Csf -Body @{ status="ACTIVE" }
Probe "DEAL invitations"     GET  "/deals/$deal/invitations" ownerA -Csf
Probe "DEAL invitation get"  GET  "/deals/$deal/invitations/$bInviteId" ownerA -Csf
Probe "DEAL invite create"   POST "/deals/$deal/invitations" ownerA -Csf -Body @{ inviteeEmail="cp-$((Get-Random).ToString())@e2e.test"; role="COUNTERPARTY" }
Probe "DEAL invite revoke"   POST "/deals/$deal/invitations/$bInviteId/revoke" ownerA -Csf -Body @{}
Probe "DEAL room"            GET  "/deals/$deal/room" ownerA
Probe "DEAL-invite lookup"   GET  "/deal-invitations/$DUMMY" none
Probe "DEAL-invite accept"   POST "/deal-invitations/$DUMMY/accept" memberD -Csf -Body @{}
Probe "DEAL-invite decline"  POST "/deal-invitations/$DUMMY/decline" memberD -Csf -Body @{}

# ---- OFFERS ----
Probe "OFFER list"           GET  "/deals/$deal/offers" ownerA
Probe "OFFER get"            GET  "/deals/$deal/offers/$offerId" ownerA
Probe "OFFER submit"         POST "/deals/$deal/offers/$offerId/submit" ownerA -Csf -Body @{ requestId="e2e-probe-sub-01" }
Probe "OFFER counter"        POST "/deals/$deal/offers/$offerId/counter" ownerA -Csf -Body @{ currency="USD"; amount="990000.00"; price="980000.00"; requestId="e2e-probe-counter-01"; idempotencyKey="e2e-probe-counter-k01" }
Probe "OFFER accept"         POST "/deals/$deal/offers/$offerId/accept" ownerA -Csf -Body @{ requestId="e2e-probe-acc-01" }
Probe "OFFER reject"         POST "/deals/$deal/offers/$offerId/reject" ownerA -Csf -Body @{ requestId="e2e-probe-rej-01"; reason="probing reject" }
Probe "OFFER withdraw"       POST "/deals/$deal/offers/$offerId/withdraw" ownerA -Csf -Body @{ requestId="e2e-probe-wd-01" }
Probe "NEGOTIATION"          GET  "/deals/$deal/negotiation" ownerA

# ---- DOCUMENTS ----
Probe "DOC list"             GET  "/deals/$deal/documents" ownerA
Probe "DOC get"              GET  "/deals/$deal/documents/$docId" ownerA
Probe "DOC versions"         GET  "/deals/$deal/documents/$docId/versions" ownerA
Probe "DOC upload (octet)"   PUT  "/deals/$deal/documents/$docId/upload" ownerA -Csf  # binary handled below separately
Probe "DOC complete"         POST "/deals/$deal/documents/$docId/complete" ownerA -Csf
Probe "DOC submit"           POST "/deals/$deal/documents/$docId/submit" ownerA -Csf -Body @{ requestId="e2e-probe-doc-sub-01" }
Probe "DOC withdraw"         POST "/deals/$deal/documents/$docId/withdraw" ownerA -Csf -Body @{ requestId="e2e-probe-doc-wd-01" }
Probe "DOC review"           POST "/deals/$deal/documents/$docId/review" ownerA -Csf -Body @{ decision="ACCEPT"; comment="looks good" }
Probe "DOC replace"          POST "/deals/$deal/documents/$docId/replace" ownerA -Csf -Body @{ documentType="GENERAL"; title="E2E probe doc v2" }
Probe "DOC download"         GET  "/deals/$deal/documents/$docId/download" ownerA -Headers @("Accept: application/octet-stream")

# ---- REQUIREMENTS ----
Probe "REQ list"             GET  "/deals/$deal/requirements" ownerA
Probe "REQ get"              GET  "/deals/$deal/requirements/$reqId" ownerA
Probe "REQ submit"           POST "/deals/$deal/requirements/$reqId/submit" ownerA -Csf -Body @{ requestId="e2e-probe-req-sub-01" }
Probe "REQ reject"           POST "/deals/$deal/requirements/$reqId/reject" ownerA -Csf -Body @{ requestId="e2e-probe-req-rej-01"; reason="probing" }
Probe "REQ waive"            POST "/deals/$deal/requirements/$reqId/waive" ownerA -Csf -Body @{ requestId="e2e-probe-req-waive-01" }
Probe "REQ reopen"           POST "/deals/$deal/requirements/$reqId/reopen" ownerA -Csf -Body @{ requestId="e2e-probe-req-rop-01" }
Probe "REQ satisfy"          POST "/deals/$deal/requirements/$reqId/satisfy" ownerA -Csf -Body @{ requestId="e2e-probe-req-sat-01" }
Probe "REQ attach"           POST "/deals/$deal/requirements/$reqId/attach" ownerA -Csf -Body @{ documentId=$docId }
Probe "READINESS"            GET  "/deals/$deal/readiness" ownerA

# ---- APPROVALS (policy + workflow + requests) ----
Probe "POL list"             GET  "/organizations/$orgA/approval-policies" ownerA
Probe "POL get"              GET  "/organizations/$orgA/approval-policies/$policyId" ownerA
Probe "POL patch"            PATCH "/organizations/$orgA/approval-policies/$policyId" ownerA -Csf -Body @{ name="E2E probe policy v2" }
Probe "POL activate"         POST "/organizations/$orgA/approval-policies/$policyId/activate" ownerA -Csf -Body @{}
Probe "POL deactivate"       POST "/organizations/$orgA/approval-policies/$policyId/deactivate" ownerA -Csf -Body @{}
Probe "POL archive"          POST "/organizations/$orgA/approval-policies/$policyId/archive" ownerA -Csf -Body @{}
Probe "WF start"             POST "/organizations/$orgA/deals/$deal/approval-workflows" ownerA -Csf -Body @{ policyId=$policyId; requestId="e2e-probe-wf-01"; expiresInMinutes=1440 }
Probe "WF list (deal)"       GET  "/organizations/$orgA/deals/$deal/approval-workflows" ownerA
Probe "WF list (org)"        GET  "/organizations/$orgA/approval-workflows" ownerA
Probe "WF get"               GET  "/organizations/$orgA/approval-workflows/$DUMMY" ownerA
Probe "WF cancel"            POST "/organizations/$orgA/approval-workflows/$DUMMY/cancel" ownerA -Csf -Body @{}
Probe "WF expire"            POST "/organizations/$orgA/approval-workflows/expire" ownerA -Csf -Body @{}
Probe "REQ list (approvals)" GET  "/organizations/$orgA/approval-requests" ownerA
Probe "REQ get (approval)"   GET  "/organizations/$orgA/approval-requests/$DUMMY" ownerA
Probe "REQ decide"           POST "/organizations/$orgA/approval-requests/$DUMMY/decide" ownerA -Csf -Body @{ action="APPROVE"; reason="probing" }
Probe "REQ assign"           POST "/organizations/$orgA/approval-requests/$DUMMY/assign" ownerA -Csf -Body @{ approverUserId=$uD }
Probe "REQ escalate"         POST "/organizations/$orgA/approval-requests/$DUMMY/escalate" ownerA -Csf -Body @{ reason="probing" }
Probe "REQ cancel"           POST "/organizations/$orgA/approval-requests/$DUMMY/cancel" ownerA -Csf -Body @{}
Probe "READINESS gate"       GET  "/organizations/$orgA/deals/$deal/approval-readiness" ownerA
Probe "POL for deal"         GET  "/organizations/$orgA/deals/$deal/approval-policy" ownerA

# ---- SETTLEMENT ----
Probe "SET list"             GET  "/deals/$deal/settlement" ownerA
Probe "SET create"           POST "/deals/$deal/settlement" ownerA -Csf -Body @{ idempotencyKey="e2e-probe-set-0001"; requestId="e2e-probe-set-req-01" }
Probe "SET get"              GET  "/deals/$deal/settlement/$DUMMY" ownerA
Probe "SET history"          GET  "/deals/$deal/settlement/$DUMMY/history" ownerA
Probe "SET submit"           POST "/deals/$deal/settlement/$DUMMY/submit" ownerA -Csf -Body @{ requestId="e2e-probe-set-sub-01" }
Probe "SET cancel"           POST "/deals/$deal/settlement/$DUMMY/cancel" ownerA -Csf -Body @{ requestId="e2e-probe-set-cancel-01" }
Probe "RECON list"           GET  "/deals/$deal/reconciliation" ownerA
Probe "RECON get"            GET  "/deals/$deal/reconciliation/$DUMMY" ownerA
Probe "RECON by settlement"  GET  "/deals/$deal/settlement/$DUMMY/reconciliation" ownerA
Probe "RECON reconcile"      POST "/deals/$deal/settlement/$DUMMY/reconcile" ownerA -Csf -Body @{ requestId="e2e-probe-recon-01" }
Probe "RECON resolve"        POST "/deals/$deal/reconciliation/$DUMMY/resolve" ownerA -Csf -Body @{ requestId="e2e-probe-recon-res-01"; resolutionReason="probing" }

# ---- PHASE 9 INTELLIGENCE ----
Probe "AI analyze (replay expected)" POST "/deals/$deal/intelligence/analyze" ownerA -Csf -Body @{ requestId="e2e-probe-ai-again" }
Probe "AI list runs"        GET  "/deals/$deal/intelligence" ownerA
Probe "AI get run"          GET  "/deals/$deal/intelligence/$runId" ownerA
Probe "AI query in-scope"   POST "/deals/$deal/intelligence/query" ownerA -Csf -Body @{ question="What is the notional amount and currency of this deal?"; requestId="e2e-probe-q-01" }

# ---- RBAC / tenant isolation ----
Probe "RBAC-B me"           GET  "/auth/me" counterB
Probe "RBAC-C me"           GET  "/auth/me" outsiderC
Probe "RBAC-C deal get (404)" GET "/deals/$deal/participants" outsiderC
Probe "RBAC-C AI analyze (404)" POST "/deals/$deal/intelligence/analyze" outsiderC -Csf -Body @{ requestId="e2e-probe-rbac-c" }
Probe "RBAC-C AI list (404)" GET  "/deals/$deal/intelligence" outsiderC

Write-Host "`n================ DONE ================"
