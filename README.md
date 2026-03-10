# Load Balancer vRO CRUD Automation

> **Production-ready vRO Actions and Workflows for automating Load Balancer CRUD operations via REST APIs — AVI (NSX ALB) and F5 BIG-IP LTM.**

**Compatible:** VCF 9 / vRO 8.x / ARIA Automation 8.x  
**Invokable from:** ServiceNow Flow Designer, vRA Blueprints, or direct vRO execution  
**Language:** JavaScript (vRO Action-compatible)

---

## Supported Load Balancers

| Load Balancer | Directory | Objects Managed | API |
|---------------|-----------|-----------------|-----|
| **AVI (NSX ALB)** | [`/avi`](./avi/) | Health Monitor, Pool, VsVip, Virtual Service | AVI REST API |
| **F5 BIG-IP LTM** | [`/f5`](./f5/) | Node, Health Monitor, Pool, Pool Member, Virtual Server, iRule | iControl REST API |

---

## Quick Start

### AVI Load Balancer
```
avi/
├── actions/
│   ├── aviAuth.js               # Session auth + CSRF + HTTP helper
│   ├── aviHealthMonitor.js      # Health Monitor CRUD
│   ├── aviPool.js               # Pool CRUD + add/remove servers
│   ├── aviVsVip.js              # Virtual IP CRUD
│   └── aviVirtualService.js     # Virtual Service CRUD + runtime status
├── workflows/
│   └── aviCrudDemoWorkflow.js   # E2E demo (ServiceNow-compatible JSON payload)
└── docs/
    └── README.md                # Full setup & testing guide
```
[Read AVI documentation →](./avi/docs/README.md)

### F5 BIG-IP LTM
```
f5/
├── actions/
│   ├── f5Auth.js                # Token auth + session + transactions + URI builder
│   ├── f5Node.js                # Node CRUD (backend server registration)
│   ├── f5Monitor.js             # Health Monitor CRUD (HTTP, HTTPS, TCP, ICMP)
│   ├── f5Pool.js                # Pool CRUD + member management
│   ├── f5VirtualServer.js       # Virtual Server CRUD + stats
│   └── f5iRule.js               # iRule CRUD + attach/detach + templates
├── workflows/
│   └── f5CrudDemoWorkflow.js    # E2E demo (ServiceNow-compatible JSON payload)
└── docs/
    └── README.md                # Full setup, ServiceNow integration & best practices
```
[Read F5 documentation →](./f5/docs/README.md)

---

## ServiceNow Integration

Both workflows support invocation from **ServiceNow Flow Designer** via the vRO REST API using a single JSON payload parameter:

| Load Balancer | Payload Parameter     | Guide |
|---------------|-----------------------|-------|
| **AVI (NSX ALB)** | `aviRequestPayload`  | [AVI ServiceNow Integration Guide](./avi/docs/README.md#servicenow-integration) |
| **F5 BIG-IP LTM** | `f5RequestPayload`   | [F5 ServiceNow Integration Guide](./f5/docs/README.md#servicenow-integration) |

### Invocation Pattern

```
POST https://<vro-host>/vco/api/workflows/<workflow-id>/executions
Content-Type: application/json
Authorization: Basic <credentials>

// AVI example:
{
  "parameters": [{
    "value": { "string": { "value": "<json-payload>" }},
    "type": "string",
    "name": "aviRequestPayload"
  }]
}

// F5 example:
{
  "parameters": [{
    "value": { "string": { "value": "<json-payload>" }},
    "type": "string",
    "name": "f5RequestPayload"
  }]
}
```

Both workflows support dual-input mode: individual vRO parameters (for direct runs) or a single JSON payload string (for ServiceNow integration). See each guide for complete instructions including Flow Designer scripts, catalog item setup, and credential management.

---

## Architecture Comparison

| Aspect               | AVI (NSX ALB)                          | F5 BIG-IP                              |
|----------------------|----------------------------------------|----------------------------------------|
| Auth                 | Session cookies + CSRF token           | Token-based (X-F5-Auth-Token)          |
| Server model         | Inline in Pool                         | Node → Pool Member (two-step)          |
| VIP model            | Separate VsVip object                  | Destination field on Virtual Server    |
| Update pattern       | GET → merge → PUT (full object)        | PATCH (partial update)                 |
| Transactions         | Not supported                          | Supported (atomic batch ops)           |
| Traffic scripting    | DataScripts                            | iRules (Tcl)                           |
| Multi-tenant         | Tenant-based                           | Partition-based (~Common~)             |

---

## License

Internal use. Provided as-is for demonstration and customer engagement.
