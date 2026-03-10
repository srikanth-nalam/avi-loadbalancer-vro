# F5 BIG-IP LTM — vRO CRUD Automation Package

> **Full Create, Read, Update, Delete operations for F5 BIG-IP LTM objects via iControl REST API, orchestrated through VMware vRealize Orchestrator (vRO), invokable from ServiceNow.**

**Compatible:** VCF 9 / vRO 8.x / ARIA Automation 8.x  
**F5 API:** iControl REST (BIG-IP v12.x – v17.x)  
**Auth:** Token-Based Authentication (X-F5-Auth-Token)  
**Version:** 1.0.0

---

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [F5 vs AVI — Key Differences](#f5-vs-avi--key-differences)
4. [File Structure](#file-structure)
5. [Prerequisites](#prerequisites)
6. [Setup Instructions](#setup-instructions)
7. [ServiceNow Integration](#servicenow-integration)
8. [Workflow Inputs](#workflow-inputs)
9. [Running the Demo](#running-the-demo)
10. [What the Demo Does](#what-the-demo-does)
11. [Individual Action Reference](#individual-action-reference)
12. [Architectural Best Practices](#architectural-best-practices)
13. [Troubleshooting](#troubleshooting)
14. [Extending the Package](#extending-the-package)
15. [API Reference Links](#api-reference-links)

---

## Overview

This package provides a **modular, production-ready** set of vRO Actions and a demo Workflow that perform full CRUD operations against an F5 BIG-IP LTM via the iControl REST API.

**Objects managed:**
| Object         | API Endpoint                      | Description                                |
|----------------|-----------------------------------|--------------------------------------------|
| Node           | `/mgmt/tm/ltm/node`              | Backend server (IP registration)           |
| Health Monitor | `/mgmt/tm/ltm/monitor/<type>`    | Server health checks (HTTP, TCP, ICMP)     |
| Pool           | `/mgmt/tm/ltm/pool`              | Group of nodes + LB algorithm + monitor    |
| Pool Member    | `/mgmt/tm/ltm/pool/<name>/members` | Node:Port binding in a pool              |
| Virtual Server | `/mgmt/tm/ltm/virtual`           | Front-end VIP + port → pool mapping        |
| iRule          | `/mgmt/tm/ltm/rule`              | Traffic scripting (redirects, headers)     |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   ServiceNow Catalog                         │
│  (User submits LB request → Flow Designer triggers vRO)     │
└───────────────────────┬─────────────────────────────────────┘
                        │  POST /vco/api/workflows/<id>/executions
                        │  Body: { f5RequestPayload: "<json>" }
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                    vRO Workflow                               │
│              f5CrudDemoWorkflow.js                            │
│                                                              │
│  LOGIN → CREATE → READ → UPDATE → DELETE → LOGOUT            │
│                                                              │
│  Supports two invocation modes:                              │
│    A) Individual vRO input params (manual runs)              │
│    B) Single JSON payload (ServiceNow integration)           │
└──────────┬──────────────────────────────────────────────────┘
           │  calls vRO Actions:
           │
           ├── f5Auth.js              (token auth, session, HTTP helper)
           ├── f5Node.js              (CRUD for backend server nodes)
           ├── f5Monitor.js           (CRUD for health monitors)
           ├── f5Pool.js              (CRUD for pools + member management)
           ├── f5VirtualServer.js     (CRUD for virtual servers)
           └── f5iRule.js             (CRUD for iRules + attach/detach)
                     │
                     ▼
           ┌──────────────────────┐
           │  F5 BIG-IP LTM       │
           │  iControl REST API    │
           │  /mgmt/tm/ltm/*      │
           └──────────────────────┘
```

---

## F5 vs AVI — Key Differences

| Aspect               | F5 BIG-IP                              | AVI (NSX ALB)                          |
|----------------------|----------------------------------------|----------------------------------------|
| Auth mechanism       | Token-based (X-F5-Auth-Token)          | Session cookies + CSRF token           |
| Server registration  | Node + Pool Member (two-step)          | Inline in Pool (single-step)           |
| API base path        | `/mgmt/tm/ltm/...`                     | `/api/...`                             |
| Monitor endpoints    | Per-type: `/monitor/http`, `/monitor/tcp` | Unified: `/api/healthmonitor`       |
| VIP model            | Destination field on Virtual Server    | Separate VsVip object                  |
| Partial updates      | PATCH (partial) or PUT (full replace)  | PUT only (full object required)        |
| Partition support    | Yes (`~Common~name` URI encoding)      | Tenant-based                           |
| Transactions         | Yes (atomic batch operations)          | No native transactions                 |
| Traffic scripting    | iRules (Tcl-based)                     | DataScripts / Policies                 |
| Update best practice | PATCH for partial updates              | GET → merge → PUT                      |

---

## File Structure

```
f5-vro-crud/
├── actions/
│   ├── f5Auth.js               # Token auth, session, HTTP helper, transactions, URI builder
│   ├── f5Node.js               # Node CRUD (backend server registration)
│   ├── f5Monitor.js            # Health Monitor CRUD (HTTP, HTTPS, TCP, ICMP)
│   ├── f5Pool.js               # Pool CRUD + member add/remove/enable/disable
│   ├── f5VirtualServer.js      # Virtual Server CRUD + enable/disable + stats
│   └── f5iRule.js              # iRule CRUD + attach/detach to VS + templates
├── workflows/
│   └── f5CrudDemoWorkflow.js   # Main E2E workflow (ServiceNow-compatible)
└── docs/
    └── README.md               # This file
```

---

## Prerequisites

1. **F5 BIG-IP** (v12.x or later) with iControl REST API enabled
2. **Admin credentials** with read/write access to LTM objects
3. **vRO 8.x / ARIA Orchestrator** with the REST plugin
4. **Network connectivity** — vRO must reach F5 management IP on port 443
5. **ServiceNow** (optional) — for catalog-driven automation
6. **ServiceNow MID Server** (optional) — if F5 is not directly reachable from ServiceNow

---

## Setup Instructions

### Step 1: Import vRO Actions

1. Open **vRO Client** (ARIA Automation Orchestrator)
2. Navigate to **Library → Actions**
3. Create a new **Action Module**: `com.f5.bigip`
4. For each `.js` file in `actions/`, create corresponding Actions:

| File                  | Actions to Create                                                    |
|-----------------------|----------------------------------------------------------------------|
| `f5Auth.js`           | `f5Login`, `f5Logout`, `f5RefreshToken`, `f5MakeRequest`, `f5BuildUri`, `f5CreateTransaction`, `f5CommitTransaction`, `f5MakeTransactionalRequest` |
| `f5Node.js`           | `f5CreateNode`, `f5GetNode`, `f5UpdateNode`, `f5DeleteNode`, `f5ListNodes`, `f5EnableDisableNode` |
| `f5Monitor.js`        | `f5CreateMonitor`, `f5GetMonitor`, `f5UpdateMonitor`, `f5DeleteMonitor`, `f5ListMonitors` |
| `f5Pool.js`           | `f5CreatePool`, `f5GetPool`, `f5UpdatePool`, `f5AddPoolMember`, `f5RemovePoolMember`, `f5EnableDisablePoolMember`, `f5DeletePool`, `f5ListPools`, `f5GetPoolMembers` |
| `f5VirtualServer.js`  | `f5CreateVirtualServer`, `f5GetVirtualServer`, `f5UpdateVirtualServer`, `f5EnableDisableVirtualServer`, `f5DeleteVirtualServer`, `f5ListVirtualServers`, `f5GetVirtualServerStats` |
| `f5iRule.js`          | `f5CreateiRule`, `f5GetiRule`, `f5UpdateiRule`, `f5DeleteiRule`, `f5ListiRules`, `f5AttachiRuleToVS`, `f5DetachiRuleFromVS`, `f5GetHttpRedirectiRule`, `f5GetMaintenancePageiRule`, `f5GetXForwardedForiRule` |

5. Set Input Parameters and Return Types per JSDoc headers.

### Step 2: Create the Demo Workflow

1. Create Workflow: **F5 BIG-IP LTM CRUD Demo**
2. Add a **Scriptable Task**
3. Configure inputs (see [Workflow Inputs](#workflow-inputs))
4. Paste `f5CrudDemoWorkflow.js` into the script
5. Import action references at the top:

```javascript
var f5Login = System.getModule("com.f5.bigip").f5Login;
var f5Logout = System.getModule("com.f5.bigip").f5Logout;
var f5RefreshToken = System.getModule("com.f5.bigip").f5RefreshToken;
var f5MakeRequest = System.getModule("com.f5.bigip").f5MakeRequest;
var f5BuildUri = System.getModule("com.f5.bigip").f5BuildUri;
var f5CreateNode = System.getModule("com.f5.bigip").f5CreateNode;
// ... etc. for all actions
```

---

## ServiceNow Integration

### How It Works

ServiceNow Flow Designer sends a JSON payload to the vRO workflow via the REST API. The workflow parses this payload and performs the requested operations on the F5 BIG-IP.

### ServiceNow → vRO Payload Format

The workflow accepts a single `f5RequestPayload` string parameter containing a JSON object:

```json
{
  "bigIpHost": "f5-bigip.lab.local",
  "username": "admin",
  "password": "admin123",
  "vipAddress": "10.0.1.100",
  "servicePort": 80,
  "server1Ip": "10.0.1.10",
  "server2Ip": "10.0.1.11",
  "server3Ip": "10.0.1.12",
  "serverPort": 80,
  "partition": "Common"
}
```

### ServiceNow Flow Designer Configuration

1. **Create a Catalog Item** in ServiceNow with fields:
   - F5 Host (string)
   - VIP Address (string)
   - Backend Server 1 IP (string)
   - Backend Server 2 IP (string)
   - Server Port (integer)
   - Service Port (integer)

2. **Create a Flow** in Flow Designer:
   - **Trigger**: Service Catalog item submitted + approved
   - **Step 1**: Script step — Build the f5RequestPayload JSON from catalog variables
   - **Step 2**: REST step — Call vRO API:
     ```
     POST https://<vro-host>/vco/api/workflows/<workflow-id>/executions
     Headers: Authorization: Basic <credentials>
     Body:
     {
       "parameters": [{
         "value": { "string": { "value": "<f5RequestPayload_json_string>" }},
         "type": "string",
         "name": "f5RequestPayload"
       }]
     }
     ```
   - **Step 3**: Script step — Parse response, update RITM with results

3. **Build Payload Action** (reusable ServiceNow Action):
   ```javascript
   // ServiceNow Flow Designer Script Step
   (function execute(inputs, outputs) {
       var ritm = new GlideRecord('sc_req_item');
       ritm.get(inputs.ritm_sys_id);

       var vars = {};
       var mtom = new GlideRecord('sc_item_option_mtom');
       mtom.addQuery('request_item', ritm.sys_id);
       mtom.query();
       while (mtom.next()) {
           var opt = mtom.sc_item_option.getRefRecord();
           vars[opt.item_option_new.name.toString()] = opt.value.toString();
       }

       var payload = {
           bigIpHost:   vars.f5_host || '',
           username:    vars.f5_username || 'admin',
           password:    vars.f5_password || '',
           vipAddress:  vars.vip_address || '',
           servicePort: parseInt(vars.service_port || '80'),
           server1Ip:   vars.server1_ip || '',
           server2Ip:   vars.server2_ip || '',
           server3Ip:   vars.server3_ip || '',
           serverPort:  parseInt(vars.server_port || '80'),
           partition:   vars.partition || 'Common'
       };

       // Wrap for vRO API format
       var vroPayload = {
           parameters: [{
               value: { string: { value: JSON.stringify(payload) }},
               type: "string",
               name: "f5RequestPayload"
           }]
       };

       outputs.payload_json = JSON.stringify(vroPayload);
   })(inputs, outputs);
   ```

### Credential Best Practice

Store F5 credentials in **vRO Configuration Elements** (not in ServiceNow):
1. In vRO: Create a Config Element under `com.f5.bigip.config`
2. Store: `bigIpHost`, `username`, `password` (as SecureString)
3. Modify the workflow to read credentials from config element instead of input params
4. ServiceNow only needs to pass the LB request details (VIP, servers, ports)

---

## Workflow Inputs

### Option A: Direct vRO Execution (Individual Parameters)

| Name         | Type         | Required | Description                         |
|--------------|--------------|----------|-------------------------------------|
| bigIpHost    | string       | Yes      | F5 management IP or FQDN           |
| username      | string       | Yes      | Admin username                      |
| password      | SecureString | Yes      | Admin password                      |
| vipAddress    | string       | Yes      | Virtual IP (e.g., 10.0.1.100)      |
| servicePort   | number       | No       | Frontend port (default: 80)         |
| server1Ip     | string       | Yes      | Backend server 1 IP                 |
| server2Ip     | string       | Yes      | Backend server 2 IP                 |
| server3Ip     | string       | No       | Server 3 (added during UPDATE)      |
| serverPort    | number       | No       | Backend port (default: 80)          |
| partition     | string       | No       | F5 partition (default: Common)      |

### Option B: ServiceNow Invocation (Single JSON Payload)

| Name              | Type   | Required | Description                                 |
|-------------------|--------|----------|---------------------------------------------|
| f5RequestPayload  | string | Yes      | JSON string with all parameters above       |

### Workflow Output

| Name       | Type   | Description                              |
|------------|--------|------------------------------------------|
| demoResult | string | JSON summary of all CRUD operations      |

---

## Running the Demo

### Expected Log Output

```
================================================================
  F5 BIG-IP LTM CRUD Demo - Starting
  Host: f5-bigip.lab.local
  Partition: Common
================================================================
  [+] 1. LOGIN | POST /mgmt/shared/authn/login | Token acquired

--- STEP 2: CREATE ---
  [+] 2a. Node 1 | CREATE | vRO-Demo-Node-01 (10.0.1.10)
  [+] 2a. Node 2 | CREATE | vRO-Demo-Node-02 (10.0.1.11)
  [+] 2b. Monitor | CREATE | vRO-Demo-Monitor-HTTP (HTTP, interval:5s, timeout:16s)
  [+] 2c. Pool | CREATE | vRO-Demo-Pool (2 members, round-robin)
  [+] 2d. iRule | CREATE | vRO-Demo-iRule-XFF (X-Forwarded-For insertion)
  [+] 2e. Virtual Server | CREATE | vRO-Demo-VirtualServer (10.0.1.100:80 → pool)

--- STEP 3: READ (Verify Creation) ---
  [+] 3a. Node 1 | READ | /Common/vRO-Demo-Node-01 (State: unchecked)
  [+] 3b. Monitor | READ | /Common/vRO-Demo-Monitor-HTTP (interval: 5s)
  [+] 3c. Pool | READ | /Common/vRO-Demo-Pool (LB: round-robin, Members: 2)
  [+] 3d. iRule | READ | /Common/vRO-Demo-iRule-XFF
  [+] 3e. Virtual Server | READ | /Common/vRO-Demo-VirtualServer (Enabled: true)

--- STEP 4: UPDATE ---
  [+] 4a. Node 3 | CREATE | vRO-Demo-Node-03 (10.0.1.12)
  [+] 4a. Add Member to Pool | UPDATE | Added vRO-Demo-Node-03:80
  [+] 4b. Update Pool LB | UPDATE | Changed to least-connections-member
  [+] 4c. Attach iRule to VS | UPDATE | Attached /Common/vRO-Demo-iRule-XFF
  [+] 4d. Verify Pool Update | READ | LB: least-connections-member, Members: 3

--- STEP 5: DELETE (Cleanup) ---
  [+] 5a. Virtual Server | DELETE | vRO-Demo-VirtualServer
  [+] 5b. Pool | DELETE | vRO-Demo-Pool
  [+] 5c. Monitor | DELETE | vRO-Demo-Monitor-HTTP
  [+] 5d. iRule | DELETE | vRO-Demo-iRule-XFF
  [+] 5e. Node 1-3 | DELETE | All nodes removed

--- STEP 6: LOGOUT ---
  [+] 6. LOGOUT | Token invalidated

================================================================
  F5 BIG-IP CRUD DEMO - SUMMARY
  Total operations: ~22
  Succeeded: 22
  Failed: 0
================================================================
```

---

## What the Demo Does

| Step | Operation | Object          | Details                                       |
|------|-----------|-----------------|-----------------------------------------------|
| 1    | LOGIN     | Token           | POST /mgmt/shared/authn/login, get auth token |
| 2a   | CREATE    | Nodes (x2)      | Register backend servers by IP                |
| 2b   | CREATE    | Monitor         | HTTP health check (interval 5s, timeout 16s)  |
| 2c   | CREATE    | Pool            | 2 members, round-robin, attached monitor      |
| 2d   | CREATE    | iRule           | X-Forwarded-For header insertion              |
| 2e   | CREATE    | Virtual Server  | VIP:port → pool, HTTP+TCP profiles, SNAT auto |
| 3    | READ      | All objects     | Verify creation, list all LTM objects         |
| 4a   | UPDATE    | Pool            | Add 3rd node + pool member                    |
| 4b   | UPDATE    | Pool            | Change LB to least-connections-member         |
| 4c   | UPDATE    | Virtual Server  | Attach iRule for X-Forwarded-For              |
| 4d   | READ      | Pool            | Verify updates applied                        |
| 5    | DELETE    | All objects     | Reverse dependency: VS → Pool → Mon → Nodes  |
| 6    | LOGOUT    | Token           | Invalidate auth token                         |

---

## Individual Action Reference

### f5Auth.js

| Function                      | Description                                   |
|-------------------------------|-----------------------------------------------|
| `f5Login()`                   | Token-based auth, returns session object       |
| `f5Logout()`                  | Invalidates auth token                         |
| `f5RefreshToken()`            | Extends token timeout (up to 10 hours)         |
| `f5MakeRequest()`             | Central HTTP helper with token + error handling|
| `f5BuildUri()`                | Partition-aware URI builder (~Common~name)      |
| `f5CreateTransaction()`       | Start atomic transaction                       |
| `f5CommitTransaction()`       | Commit/apply transaction                       |
| `f5MakeTransactionalRequest()`| Request within transaction context             |

### f5Node.js

| Function              | Verb    | Endpoint                              |
|-----------------------|---------|---------------------------------------|
| `f5CreateNode()`      | POST    | `/mgmt/tm/ltm/node`                  |
| `f5GetNode()`         | GET     | `/mgmt/tm/ltm/node/~Common~name`     |
| `f5UpdateNode()`      | PATCH   | `/mgmt/tm/ltm/node/~Common~name`     |
| `f5DeleteNode()`      | DELETE  | `/mgmt/tm/ltm/node/~Common~name`     |
| `f5ListNodes()`       | GET     | `/mgmt/tm/ltm/node`                  |
| `f5EnableDisableNode()`| PATCH  | `/mgmt/tm/ltm/node/~Common~name`     |

### f5Monitor.js

| Function              | Verb    | Endpoint                                    |
|-----------------------|---------|---------------------------------------------|
| `f5CreateMonitor()`   | POST    | `/mgmt/tm/ltm/monitor/<type>`               |
| `f5GetMonitor()`      | GET     | `/mgmt/tm/ltm/monitor/<type>/~Common~name`  |
| `f5UpdateMonitor()`   | PATCH   | `/mgmt/tm/ltm/monitor/<type>/~Common~name`  |
| `f5DeleteMonitor()`   | DELETE  | `/mgmt/tm/ltm/monitor/<type>/~Common~name`  |
| `f5ListMonitors()`    | GET     | `/mgmt/tm/ltm/monitor/<type>`               |

### f5Pool.js

| Function                      | Verb    | Endpoint                                 |
|-------------------------------|---------|------------------------------------------|
| `f5CreatePool()`              | POST    | `/mgmt/tm/ltm/pool`                     |
| `f5GetPool()`                 | GET     | `/mgmt/tm/ltm/pool/~Common~name`        |
| `f5UpdatePool()`              | PATCH   | `/mgmt/tm/ltm/pool/~Common~name`        |
| `f5AddPoolMember()`           | POST    | `/mgmt/tm/ltm/pool/~name~/members`      |
| `f5RemovePoolMember()`        | DELETE  | `/mgmt/tm/ltm/pool/~name~/members/~m~`  |
| `f5EnableDisablePoolMember()` | PATCH   | `/mgmt/tm/ltm/pool/~name~/members/~m~`  |
| `f5DeletePool()`              | DELETE  | `/mgmt/tm/ltm/pool/~Common~name`        |
| `f5ListPools()`               | GET     | `/mgmt/tm/ltm/pool`                     |
| `f5GetPoolMembers()`          | GET     | `/mgmt/tm/ltm/pool/~name~/members`      |

### f5VirtualServer.js

| Function                          | Verb    | Endpoint                                 |
|-----------------------------------|---------|------------------------------------------|
| `f5CreateVirtualServer()`         | POST    | `/mgmt/tm/ltm/virtual`                  |
| `f5GetVirtualServer()`            | GET     | `/mgmt/tm/ltm/virtual/~Common~name`     |
| `f5UpdateVirtualServer()`         | PATCH   | `/mgmt/tm/ltm/virtual/~Common~name`     |
| `f5EnableDisableVirtualServer()`  | PATCH   | `/mgmt/tm/ltm/virtual/~Common~name`     |
| `f5DeleteVirtualServer()`         | DELETE  | `/mgmt/tm/ltm/virtual/~Common~name`     |
| `f5ListVirtualServers()`          | GET     | `/mgmt/tm/ltm/virtual`                  |
| `f5GetVirtualServerStats()`       | GET     | `/mgmt/tm/ltm/virtual/~name~/stats`     |

### f5iRule.js

| Function                    | Description                                         |
|-----------------------------|-----------------------------------------------------|
| `f5CreateiRule()`           | Create iRule with Tcl code                          |
| `f5GetiRule()`              | Read iRule by name                                  |
| `f5UpdateiRule()`           | Update iRule body                                   |
| `f5DeleteiRule()`           | Delete iRule                                        |
| `f5ListiRules()`            | List all iRules                                     |
| `f5AttachiRuleToVS()`       | Attach iRule to Virtual Server                      |
| `f5DetachiRuleFromVS()`     | Detach iRule from Virtual Server                    |
| `f5GetHttpRedirectiRule()`  | Template: HTTP→HTTPS redirect                       |
| `f5GetMaintenancePageiRule()`| Template: Maintenance page when pool is down        |
| `f5GetXForwardedForiRule()` | Template: X-Forwarded-For header insertion           |

---

## Architectural Best Practices

### 1. Token-Based Authentication (Not Basic Auth)
- Token reduces credential exposure (sent once, not on every request)
- Token lifetime: 20 min default — extend via `f5RefreshToken()` for long workflows
- Invalidate tokens on logout to prevent stale sessions

### 2. Partition Isolation
- All objects are created in a partition (default: `/Common`)
- Use custom partitions for tenant isolation in multi-team environments
- URI encoding: `/Common/name` → `~Common~name`

### 3. PATCH for Updates (Not PUT)
- F5 supports PATCH for partial updates — only send changed fields
- Avoids the AVI pattern of GET → merge → PUT (more efficient, less error-prone)
- Use PUT only when replacing the entire object definition

### 4. Transactions for Atomic Operations
- Use `f5CreateTransaction()` + `f5CommitTransaction()` for batch operations
- All-or-nothing: if any command fails, all are rolled back
- Critical for production: prevents partial configurations that break traffic flow

### 5. Dependency Order
- **Create order**: Node → Monitor → Pool → iRule → Virtual Server
- **Delete order**: Virtual Server → Pool → Monitor → iRule → Node
- F5 enforces referential integrity — cannot delete referenced objects

### 6. Node vs Pool Member
- Nodes represent physical/virtual servers (IP address)
- Pool Members are Node:Port bindings within a pool
- Always create the Node first, then add as Pool Member
- Deleting a Pool Member does NOT delete the underlying Node

### 7. Health Monitor Timeout
- F5 best practice: `timeout = (interval × 3) + 1`
- Example: interval=5s → timeout=16s
- This ensures 3 missed checks before marking server down

### 8. ServiceNow Integration Pattern
- ServiceNow sends a single JSON payload (not individual parameters)
- Credentials stored in vRO config elements (never in ServiceNow)
- Workflow output returned to ServiceNow for RITM status updates
- Use MID Server if F5 is not directly reachable from ServiceNow

---

## Troubleshooting

### Authentication Fails (401)
- Verify credentials: `curl -k -u admin:admin https://<f5>/mgmt/shared/authn/login`
- Check if token expired (20-min default)
- Ensure user has admin or resource-admin role

### 409 Conflict (Object Already Exists)
- Actions handle this gracefully (return success with warning)
- To force recreate: delete the object first, then create

### 400 Bad Request
- Check vRO logs for F5 error message
- Common: partition mismatch, invalid IP format, missing required field
- Ensure VIP is not already in use by another VS

### 404 Not Found
- Object name or partition may be incorrect
- Check URI encoding: `~Common~name` (tilde, not slash)
- Verify the object type endpoint matches (e.g., `/monitor/http` not `/monitor`)

### Delete Fails (Still Referenced)
- Delete in reverse dependency order: VS → Pool → Monitor → Node
- Cannot delete a Node that is still a Pool Member
- Cannot delete a Pool that is still referenced by a VS

### SSL/Certificate Errors
- Import F5's management certificate into vRO trust store
- vRO: **Administration → Configuration → SSL Trust Manager → Import**

---

## Extending the Package

### Add HTTPS Virtual Server with SSL Offloading
```javascript
var vs = f5CreateVirtualServer(session, "vs-https-app", "10.0.1.100:443",
    "255.255.255.255", "pool-app",
    [{ "name": "http" }, { "name": "tcp" }, { "name": "clientssl", "context": "clientside" }],
    "automap", "cookie", null, "Common", "tcp");
```

### Add ICMP Health Monitor
```javascript
var mon = f5CreateMonitor(session, "mon-icmp-app", "gateway-icmp", 10, 31, null, null, "Common");
```

### Use Transactions for Atomic Deployment
```javascript
var txnId = f5CreateTransaction(session);
f5MakeTransactionalRequest(session, "POST", "/mgmt/tm/ltm/node", nodePayload, txnId);
f5MakeTransactionalRequest(session, "POST", "/mgmt/tm/ltm/pool", poolPayload, txnId);
f5MakeTransactionalRequest(session, "POST", "/mgmt/tm/ltm/virtual", vsPayload, txnId);
f5CommitTransaction(session, txnId);  // All-or-nothing
```

### Content Switching with iRule
```javascript
var iRuleBody = 'when HTTP_REQUEST {\n' +
    '    switch -glob [HTTP::uri] {\n' +
    '        "/api/*" { pool pool-api }\n' +
    '        "/static/*" { pool pool-static }\n' +
    '        default { pool pool-default }\n' +
    '    }\n' +
    '}';
f5CreateiRule(session, "irule-content-switch", iRuleBody, "Common");
f5AttachiRuleToVS(session, "vs-app", "/Common/irule-content-switch", "Common");
```

---

## API Reference Links

- [F5 iControl REST API User Guide (PDF)](https://cdn.f5.com/websites/devcentral.f5.com/downloads/icontrol-rest-api-user-guide-14-1-0.pdf)
- [F5 iControl REST API Reference](https://clouddocs.f5.com/api/icontrol-rest/)
- [F5 DevCentral — Token-Based Auth](https://community.f5.com/kb/technicalarticles/demystifying-icontrol-rest-part-6-token-based-authentication/286793)
- [F5 REST API Transactions Lab](https://clouddocs.f5.com/training/community/automation/html/class01/module1/lab6.html)
- [F5 Common REST API Examples (K13225405)](https://my.f5.com/manage/s/article/K13225405)
- [F5 + ServiceNow Dynamic Pool Management (Video)](https://www.youtube.com/watch?v=hpeCpqlLN6o)
- [Broadcom TechDocs — F5 Virtual Server Configuration for vRA](https://techdocs.broadcom.com/us/en/vmware-cis/aria/aria-automation/8-13/on-prem-vra-8-load-balancing-guide-8-13/configuring-f5-big-ip-ltm/configure-f5-virtual-servers.html)
- [vRO 8.x REST Plugin Documentation](https://docs.vmware.com/en/vRealize-Orchestrator/8.0/com.vmware.vrealize.orchestrator-using-plugins.doc/GUID-5A2E1404-4CA4-4D6B-9A3A-3A0A0C7D7ADB.html)

---

## License

Internal use. Provided as-is for demonstration and customer engagement purposes.
