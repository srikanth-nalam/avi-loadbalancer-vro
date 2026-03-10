# AVI Load Balancer — vRO CRUD Automation Package

> **Full Create, Read, Update, Delete operations for AVI (NSX ALB) objects via VMware vRealize Orchestrator / ARIA Automation Orchestrator.**

**Compatible:** VCF 9 / vRO 8.x / ARIA Automation 8.x  
**API Version:** AVI 22.1.x / 30.x (configurable)  
**Author:** vRO Automation Team  
**Version:** 1.0.0

---

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [File Structure](#file-structure)
4. [Prerequisites](#prerequisites)
5. [Setup Instructions](#setup-instructions)
6. [Workflow Inputs](#workflow-inputs)
7. [Running the Demo](#running-the-demo)
8. [What the Demo Does](#what-the-demo-does)
9. [Individual Action Reference](#individual-action-reference)
10. [Troubleshooting](#troubleshooting)
11. [Extending the Package](#extending-the-package)
12. [API Reference Links](#api-reference-links)

---

## Overview

This package provides a **modular, production-ready** set of vRO Actions and a demo Workflow that perform full CRUD (Create, Read, Update, Delete) operations against an AVI Load Balancer (NSX Advanced Load Balancer) controller via its REST API.

**Objects managed:**
| Object            | API Endpoint           | Description                                    |
|-------------------|------------------------|------------------------------------------------|
| Health Monitor    | `/api/healthmonitor`   | Backend server health checks (HTTP, TCP, etc.) |
| Pool              | `/api/pool`            | Group of backend servers with LB algorithm     |
| VsVip             | `/api/vsvip`           | Virtual IP address (frontend listener IP)      |
| Virtual Service   | `/api/virtualservice`  | Top-level object tying VIP + Pool together     |

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    vRO Workflow                       │
│              aviCrudDemoWorkflow.js                   │
│                                                      │
│  LOGIN → CREATE → READ → UPDATE → DELETE → LOGOUT    │
└──────────┬───────────────────────────────────────────┘
           │  calls vRO Actions:
           │
           ├── aviAuth.js            (login, logout, CSRF, HTTP helper)
           ├── aviHealthMonitor.js   (CRUD for health monitors)
           ├── aviPool.js            (CRUD for server pools)
           ├── aviVsVip.js           (CRUD for virtual IPs)
           └── aviVirtualService.js  (CRUD for virtual services)
                     │
                     ▼
           ┌──────────────────┐
           │  AVI Controller   │
           │  REST API (HTTPS) │
           │  /api/*           │
           └──────────────────┘
```

---

## File Structure

```
avi-vro-crud/
├── actions/
│   ├── aviAuth.js               # Authentication (login/logout/CSRF/request helper)
│   ├── aviHealthMonitor.js      # Health Monitor CRUD (create/get/update/delete/list)
│   ├── aviPool.js               # Pool CRUD + addServer/removeServer helpers
│   ├── aviVsVip.js              # VsVip (Virtual IP) CRUD
│   └── aviVirtualService.js     # Virtual Service CRUD + enable/disable + runtime check
├── workflows/
│   └── aviCrudDemoWorkflow.js   # Main E2E demo workflow (orchestrates all actions)
└── docs/
    └── README.md                # This file
```

---

## Prerequisites

1. **AVI Controller** (NSX ALB) accessible from the vRO appliance via HTTPS (port 443)
2. **AVI Admin credentials** with permissions to manage VS, Pool, VsVip, and Health Monitor objects
3. **vRO 8.x / ARIA Orchestrator** with the REST plugin enabled (included by default)
4. **Network connectivity** — vRO appliance must be able to reach the AVI Controller IP/FQDN
5. **AVI API version** — Check your controller version at `https://<controller>/api/initial-data`

---

## Setup Instructions

### Step 1: Import vRO Actions

1. Open **vRO Client** (ARIA Automation Orchestrator)
2. Navigate to **Library → Actions**
3. Create a new **Action Module**: `com.vmware.avi`
4. For each `.js` file in the `actions/` folder, create a new Action:

| File                       | Action Name(s) to Create                                      |
|----------------------------|---------------------------------------------------------------|
| `aviAuth.js`               | `aviLogin`, `aviGetCsrfToken`, `aviLogout`, `aviMakeRequest`  |
| `aviHealthMonitor.js`      | `createHealthMonitor`, `getHealthMonitor`, `updateHealthMonitor`, `deleteHealthMonitor`, `listHealthMonitors` |
| `aviPool.js`               | `createPool`, `getPool`, `updatePool`, `addServerToPool`, `removeServerFromPool`, `deletePool`, `listPools` |
| `aviVsVip.js`              | `createVsVip`, `getVsVip`, `updateVsVip`, `deleteVsVip`, `listVsVips` |
| `aviVirtualService.js`     | `createVirtualService`, `getVirtualService`, `updateVirtualService`, `enableDisableVirtualService`, `deleteVirtualService`, `listVirtualServices`, `getVirtualServiceRuntime` |

5. For each Action, set the **Input Parameters** and **Return Type** as documented in the JSDoc headers of each function.
6. Paste the function body into the Action's script editor.

> **Tip:** The `aviMakeRequest` function is used by all other actions. You can either:
> - Create it as a standalone action and call it via `System.getModule("com.vmware.avi").aviMakeRequest(...)`, **or**
> - Include it inline in each action file (already included for reference).

### Step 2: Create the Demo Workflow

1. Navigate to **Library → Workflows**
2. Create a new Workflow: **AVI Load Balancer CRUD Demo**
3. Add a single **Scriptable Task** element
4. Configure **Workflow Input Parameters**:

| Name           | Type         | Required | Description                          |
|----------------|--------------|----------|--------------------------------------|
| controllerIp   | string       | Yes      | AVI Controller IP or FQDN            |
| username        | string       | Yes      | Admin username                       |
| password        | SecureString | Yes      | Admin password                       |
| apiVersion      | string       | No       | API version (default: "22.1.1")      |
| vipAddress      | string       | Yes      | Virtual IP for demo (e.g., 10.0.1.100) |
| subnetMask      | number       | No       | CIDR mask (default: 24)              |
| server1Ip       | string       | Yes      | Backend server 1 IP                  |
| server2Ip       | string       | Yes      | Backend server 2 IP                  |
| server3Ip       | string       | No       | Server 3 IP (added during UPDATE)    |
| serverPort      | number       | No       | Backend port (default: 80)           |
| servicePort     | number       | No       | Frontend port (default: 80)          |
| cloudRef        | string       | No       | Cloud ref URL (optional)             |

5. Add a **Workflow Output Parameter**:

| Name       | Type   | Description                    |
|------------|--------|--------------------------------|
| demoResult | string | JSON summary of all operations |

6. Paste the contents of `workflows/aviCrudDemoWorkflow.js` into the Scriptable Task
7. **Bind** all input variables to the scriptable task's input bindings
8. **Bind** `demoResult` to the output binding

### Step 3: Configure Action References

In the Scriptable Task, make sure to import the required actions at the top. In vRO 8.x, you can use:

```javascript
var aviLogin = System.getModule("com.vmware.avi").aviLogin;
var aviGetCsrfToken = System.getModule("com.vmware.avi").aviGetCsrfToken;
var aviLogout = System.getModule("com.vmware.avi").aviLogout;
var aviMakeRequest = System.getModule("com.vmware.avi").aviMakeRequest;
var createHealthMonitor = System.getModule("com.vmware.avi").createHealthMonitor;
// ... etc. for all actions
```

---

## Workflow Inputs

### Required Inputs (minimum to run the demo)

| Parameter      | Example Value              | Notes                                    |
|----------------|----------------------------|------------------------------------------|
| controllerIp   | `avi-controller.lab.local` | FQDN or IP of your AVI controller        |
| username        | `admin`                    | AVI admin user                           |
| password        | `********`                 | SecureString in vRO                      |
| vipAddress      | `10.0.1.100`               | Must be a free IP in the target subnet   |
| server1Ip       | `10.0.1.10`                | Must be a reachable backend server       |
| server2Ip       | `10.0.1.11`                | Must be a reachable backend server       |

### Optional Inputs

| Parameter      | Default    | Notes                                          |
|----------------|------------|------------------------------------------------|
| apiVersion     | `22.1.1`   | Match your AVI controller version              |
| subnetMask     | `24`       | CIDR notation                                  |
| server3Ip      | (empty)    | If provided, added during the UPDATE step      |
| serverPort     | `80`       | Backend server listening port                  |
| servicePort    | `80`       | Frontend virtual service port                  |
| cloudRef       | (empty)    | Required in multi-cloud setups                 |

---

## Running the Demo

1. Open the workflow in vRO Client
2. Click **Run**
3. Fill in the input parameters
4. Watch the **Logs** tab for real-time progress
5. Check the **Variables** tab for the `demoResult` JSON output

### Expected Log Output

```
================================================================
  AVI Load Balancer CRUD Demo — Starting
  Controller: avi-controller.lab.local
  API Version: 22.1.1
================================================================
  [✓] 1. LOGIN | POST /login | Authenticated to avi-controller.lab.local

--- STEP 2: CREATE ---
  [✓] 2a. Health Monitor | CREATE | vRO-Demo-HealthMonitor (UUID: hm-xxxx)
  [✓] 2b. Pool | CREATE | vRO-Demo-Pool with 2 servers (UUID: pool-xxxx)
  [✓] 2c. VsVip | CREATE | vRO-Demo-VsVip (VIP: 10.0.1.100, UUID: vsvip-xxxx)
  [✓] 2d. Virtual Service | CREATE | vRO-Demo-VirtualService (Port: 80, UUID: vs-xxxx)

--- STEP 3: READ (Verify Creation) ---
  [✓] 3a. Health Monitor | READ | Type: HEALTH_MONITOR_HTTP, Interval: 10s
  [✓] 3b. Pool | READ | Algorithm: LB_ALGORITHM_ROUND_ROBIN, Servers: 2
  [✓] 3c. VsVip | READ | VIP: 10.0.1.100
  [✓] 3d. Virtual Service | READ | Port: 80, Enabled: true

--- STEP 4: UPDATE ---
  [✓] 4a. Add Server to Pool | UPDATE | Added 10.0.1.12:80 → Total servers: 3
  [✓] 4b. Update Pool Algorithm | UPDATE | Changed to LB_ALGORITHM_LEAST_CONNECTIONS
  [✓] 4c. Verify Pool Update | READ | Algorithm: LB_ALGORITHM_LEAST_CONNECTIONS, Servers: 3

--- STEP 5: DELETE (Cleanup) ---
  [✓] 5a. Virtual Service | DELETE | UUID: vs-xxxx
  [✓] 5b. VsVip | DELETE | UUID: vsvip-xxxx
  [✓] 5c. Pool | DELETE | UUID: pool-xxxx
  [✓] 5d. Health Monitor | DELETE | UUID: hm-xxxx

--- STEP 6: LOGOUT ---
  [✓] 6. LOGOUT | POST /logout | Session ended.

================================================================
  AVI CRUD DEMO — SUMMARY
  Total operations: 17
  Succeeded: 17
  Failed: 0
================================================================
```

---

## What the Demo Does

| Step | Operation | Object               | Details                                              |
|------|-----------|----------------------|------------------------------------------------------|
| 1    | LOGIN     | Session              | POST /login, gets session cookies + CSRF token       |
| 2a   | CREATE    | Health Monitor       | HTTP health check (GET /, expect 2XX/3XX)            |
| 2b   | CREATE    | Pool                 | 2 backend servers, Round Robin, attached HM          |
| 2c   | CREATE    | VsVip                | Virtual IP address on the target subnet              |
| 2d   | CREATE    | Virtual Service      | Ties Pool + VsVip, port 80, TCP                      |
| 3a-d | READ      | All objects          | Verify each object was created correctly             |
| 3e   | LIST      | All types            | List all objects of each type on the controller      |
| 4a   | UPDATE    | Pool                 | Add a 3rd server to the pool                         |
| 4b   | UPDATE    | Pool                 | Change LB algorithm to Least Connections             |
| 4c   | READ      | Pool                 | Verify updates applied                               |
| 5a-d | DELETE    | All objects          | Delete in reverse dependency order (VS → VIP → Pool → HM) |
| 6    | LOGOUT    | Session              | POST /logout, end session                            |

---

## Individual Action Reference

### aviAuth.js

| Function           | Description                                     | Returns               |
|--------------------|-------------------------------------------------|-----------------------|
| `aviLogin()`       | Authenticates, returns REST host with cookies    | `REST:RESTHost`       |
| `aviGetCsrfToken()`| Extracts CSRF token from session cookies         | `string`              |
| `aviLogout()`      | Ends the authenticated session                   | `boolean`             |
| `aviMakeRequest()` | Central HTTP helper with headers/error handling  | `{statusCode, body, success}` |

### aviHealthMonitor.js

| Function                  | Verb   | Endpoint                    |
|---------------------------|--------|-----------------------------|
| `createHealthMonitor()`   | POST   | `/api/healthmonitor`        |
| `getHealthMonitor()`      | GET    | `/api/healthmonitor?name=`  |
| `updateHealthMonitor()`   | PUT    | `/api/healthmonitor/<uuid>` |
| `deleteHealthMonitor()`   | DELETE | `/api/healthmonitor/<uuid>` |
| `listHealthMonitors()`    | GET    | `/api/healthmonitor`        |

### aviPool.js

| Function                  | Verb   | Endpoint               |
|---------------------------|--------|------------------------|
| `createPool()`            | POST   | `/api/pool`            |
| `getPool()`               | GET    | `/api/pool?name=`      |
| `updatePool()`            | PUT    | `/api/pool/<uuid>`     |
| `addServerToPool()`       | PUT    | `/api/pool/<uuid>`     |
| `removeServerFromPool()`  | PUT    | `/api/pool/<uuid>`     |
| `deletePool()`            | DELETE | `/api/pool/<uuid>`     |
| `listPools()`             | GET    | `/api/pool`            |

### aviVsVip.js

| Function          | Verb   | Endpoint               |
|-------------------|--------|------------------------|
| `createVsVip()`   | POST   | `/api/vsvip`           |
| `getVsVip()`      | GET    | `/api/vsvip?name=`     |
| `updateVsVip()`   | PUT    | `/api/vsvip/<uuid>`    |
| `deleteVsVip()`   | DELETE | `/api/vsvip/<uuid>`    |
| `listVsVips()`    | GET    | `/api/vsvip`           |

### aviVirtualService.js

| Function                          | Verb   | Endpoint                         |
|-----------------------------------|--------|----------------------------------|
| `createVirtualService()`          | POST   | `/api/virtualservice`            |
| `getVirtualService()`             | GET    | `/api/virtualservice?name=`      |
| `updateVirtualService()`          | PUT    | `/api/virtualservice/<uuid>`     |
| `enableDisableVirtualService()`   | PUT    | `/api/virtualservice/<uuid>`     |
| `deleteVirtualService()`          | DELETE | `/api/virtualservice/<uuid>`     |
| `listVirtualServices()`           | GET    | `/api/virtualservice`            |
| `getVirtualServiceRuntime()`      | GET    | `/api/virtualservice/<uuid>/runtime` |

---

## Troubleshooting

### Authentication Fails (401/403)
- Verify credentials are correct
- Check that the AVI Controller is reachable from vRO: `ping <controller_ip>` from vRO shell
- Ensure the user has admin or write permissions
- Check if the account is locked out

### CSRF Token Error
- The `aviMakeRequest` function automatically handles CSRF tokens
- If you get "CSRF token mismatch", the session may have expired — re-authenticate

### SSL Certificate Errors
- If the AVI Controller uses a self-signed cert, you may need to import it into vRO's trust store
- In vRO: **Administration → Configuration → SSL Trust Manager → Import Certificate**

### Object Creation Fails (400 Bad Request)
- Check the vRO logs for the full API response body
- Common issues:
  - **VIP address already in use** — use a different IP
  - **Subnet mismatch** — ensure VIP is in the correct subnet
  - **Missing cloud_ref** — required in multi-cloud/multi-tenant setups
  - **API version mismatch** — check `X-Avi-Version` matches your controller

### Delete Fails (409 Conflict)
- Objects must be deleted in reverse dependency order:
  1. Virtual Service (references VsVip + Pool)
  2. VsVip
  3. Pool
  4. Health Monitor
- You cannot delete a Pool that is still referenced by a Virtual Service

### REST Host Issues
- "Cannot create REST host" → Ensure the vRO REST plugin is installed and enabled
- Check vRO has outbound HTTPS (443) access to the AVI controller

---

## Extending the Package

### Add SSL Virtual Service
Modify the `createVirtualService` call to enable SSL:
```javascript
var vsResult = createVirtualService(
    restHost, apiVersion, "VS-Secure",
    vsvipRef, poolRef,
    443,        // port
    "TCP",
    null,       // app profile
    null,       // network profile
    true,       // SSL enabled
    "/api/sslprofile/<ssl-profile-uuid>",
    "/api/sslkeyandcertificate/<cert-uuid>",
    cloudRef, null
);
```

### Add DNS Health Monitor
```javascript
var dnsHm = createHealthMonitor(
    restHost, apiVersion,
    "HM-DNS-App1",
    "HEALTH_MONITOR_DNS",
    30, 10, 3, 2, null, null
);
```

### Integrate with ServiceNow Catalog
1. Create a ServiceNow Catalog Item with fields for VIP, servers, port
2. Use the vRO REST plugin or ARIA → ServiceNow integration to trigger this workflow
3. Pass ServiceNow form values as workflow inputs
4. Return the `demoResult` JSON back to ServiceNow as a catalog task output

### Integrate with vRA / ARIA Automation
1. Import the workflow into ARIA Automation Orchestrator
2. Create an ARIA Automation ABX action or custom resource that calls the workflow
3. Use ARIA Blueprints to expose the inputs as a self-service catalog form

---

## API Reference Links

- [AVI REST API Guide](https://avinetworks.com/docs/latest/api-guide/)
- [AVI Object Model](https://avinetworks.com/docs/latest/avi-objects/)
- [Broadcom TechDocs — AVI vRO Integration](https://techdocs.broadcom.com/us/en/vmware-security-load-balancing/avi-load-balancer/avi-load-balancer/30-1/vmware-avi-load-balancer-solutions-guide/integrating-avi-vantage-with-vro-using-vrealize-orchestrator-plugin.html)
- [Blog: Create AVI VS from vRA (Rudi Martinsen)](https://rudimartinsen.com/2021/11/14/create-avi-vs-from-vra/)
- [vRO 8.x REST Plugin Documentation](https://docs.vmware.com/en/vRealize-Orchestrator/8.0/com.vmware.vrealize.orchestrator-using-plugins.doc/GUID-5A2E1404-4CA4-4D6B-9A3A-3A0A0C7D7ADB.html)

---

## License

Internal use. Provided as-is for demonstration and customer engagement purposes.
