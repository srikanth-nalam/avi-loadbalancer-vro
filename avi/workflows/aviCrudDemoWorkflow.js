/**
 * AVI Load Balancer CRUD Demo — vRO Orchestration Workflow
 * ==========================================================
 * End-to-end workflow that demonstrates full CRUD lifecycle for
 * AVI Load Balancer objects via the REST API from vRO.
 *
 * Designed to be invoked from ServiceNow via the vRO REST API:
 *   POST /vco/api/workflows/<workflow-id>/executions
 *   Body: { "parameters": [{ "value": { "string": { "value": "<json>" }},
 *           "type": "string", "name": "aviRequestPayload" }] }
 *
 * Flow:
 *   1. LOGIN         → Authenticate to AVI Controller
 *   2. CREATE         → Health Monitor → Pool → VsVip → Virtual Service
 *   3. READ           → List all created objects, verify creation
 *   4. UPDATE         → Update pool (add a server, change LB algorithm)
 *   5. READ (verify)  → Re-read updated objects
 *   6. DELETE         → Virtual Service → VsVip → Pool → Health Monitor
 *   7. LOGOUT         → End session
 *
 * @module com.vmware.avi.demo
 * @version 1.1.0
 * @compatible VCF 9 / vRO 8.x
 *
 * ========================================================================
 * WORKFLOW INPUTS (configure in vRO Workflow Designer):
 * ========================================================================
 *
 * Option A — Individual parameters (for direct vRO runs):
 *   controllerIp    (string)       - AVI Controller IP or FQDN
 *   username         (string)       - Admin username
 *   password         (SecureString) - Admin password
 *   apiVersion       (string)       - API version (e.g., "22.1.1")
 *   vipAddress       (string)       - Virtual IP for the demo VS (e.g., "10.0.1.100")
 *   subnetMask       (number)       - Subnet mask CIDR (default: 24)
 *   server1Ip        (string)       - Backend server 1 IP (e.g., "10.0.1.10")
 *   server2Ip        (string)       - Backend server 2 IP (e.g., "10.0.1.11")
 *   server3Ip        (string)       - Backend server 3 IP (for UPDATE step, e.g., "10.0.1.12")
 *   serverPort       (number)       - Backend server port (default: 80)
 *   servicePort      (number)       - Frontend service port (default: 80)
 *   cloudRef         (string)       - Cloud ref URL (optional, e.g., "/api/cloud/<uuid>")
 *
 * Option B — Single JSON payload (for ServiceNow invocation):
 *   aviRequestPayload (string)      - JSON string containing all the above.
 *                                      ServiceNow catalog sends this via vRO API.
 *
 * WORKFLOW OUTPUT:
 *   demoResult       (string)       - JSON summary of all operations performed
 * ========================================================================
 *
 * Dependencies (vRO Actions — import all from /actions/ folder):
 *   - aviAuth.js             → aviLogin, aviGetCsrfToken, aviLogout, aviMakeRequest
 *   - aviHealthMonitor.js    → createHealthMonitor, getHealthMonitor, deleteHealthMonitor, listHealthMonitors
 *   - aviPool.js             → createPool, getPool, updatePool, addServerToPool, deletePool, listPools
 *   - aviVsVip.js            → createVsVip, getVsVip, deleteVsVip, listVsVips
 *   - aviVirtualService.js   → createVirtualService, getVirtualService, deleteVirtualService, listVirtualServices
 */


// ========================================================================
// MAIN WORKFLOW — Paste this into a vRO Scriptable Task or Workflow
// ========================================================================

(function () {

    // ====================================================================
    // CONFIGURATION — Parse inputs (supports both direct params and JSON)
    // ====================================================================

    var config = {};

    // Option B: ServiceNow sends a single JSON payload string
    if (typeof aviRequestPayload !== "undefined" && aviRequestPayload && aviRequestPayload.trim() !== "") {
        System.log("[aviCrudDemo] Parsing aviRequestPayload from ServiceNow...");
        try {
            config = JSON.parse(aviRequestPayload);
        } catch (e) {
            throw new Error("Failed to parse aviRequestPayload JSON: " + e.message);
        }
    } else {
        // Option A: Individual workflow input parameters
        config = {
            controllerIp: controllerIp,
            username:     username,
            password:     password,
            apiVersion:   apiVersion || "22.1.1",
            vipAddress:   vipAddress,
            subnetMask:   subnetMask || 24,
            server1Ip:    server1Ip,
            server2Ip:    server2Ip,
            server3Ip:    server3Ip || "",
            serverPort:   serverPort || 80,
            servicePort:  servicePort || 80,
            cloudRef:     cloudRef || ""
        };
    }

    // Apply defaults (works for both input modes)
    config.apiVersion  = config.apiVersion || "22.1.1";
    config.subnetMask  = config.subnetMask || 24;
    config.serverPort  = config.serverPort || 80;
    config.servicePort = config.servicePort || 80;
    config.cloudRef    = config.cloudRef || "";

    // Demo naming convention — easy to identify + clean up
    var DEMO_PREFIX = "vRO-Demo-";
    var hmName   = DEMO_PREFIX + "HealthMonitor";
    var poolName = DEMO_PREFIX + "Pool";
    var vipName  = DEMO_PREFIX + "VsVip";
    var vsName   = DEMO_PREFIX + "VirtualService";

    // Track created UUIDs for cleanup
    var createdUuids = {
        healthMonitor: null,
        pool: null,
        vsVip: null,
        virtualService: null
    };

    // Results log
    var results = [];

    /**
     * Helper: Log a step result and add to results array.
     * @param {string} step - Step name
     * @param {string} operation - CRUD operation
     * @param {boolean} success - Whether it succeeded
     * @param {string} details - Additional details
     */
    function logStep(step, operation, success, details) {
        var entry = {
            step: step,
            operation: operation,
            success: success,
            details: details,
            timestamp: new Date().toISOString()
        };
        results.push(entry);
        var icon = success ? "✓" : "✗";
        System.log("  [" + icon + "] " + step + " | " + operation + " | " + details);
    }


    // ====================================================================
    // STEP 1: LOGIN
    // ====================================================================
    System.log("================================================================");
    System.log("  AVI Load Balancer CRUD Demo — Starting");
    System.log("  Controller: " + config.controllerIp);
    System.log("  API Version: " + config.apiVersion);
    System.log("================================================================");

    var restHost = null;
    try {
        restHost = aviLogin(config.controllerIp, config.username, config.password, config.apiVersion);
        logStep("1. LOGIN", "POST /login", true, "Authenticated to " + config.controllerIp);
    } catch (e) {
        logStep("1. LOGIN", "POST /login", false, "FAILED: " + e.message);
        throw new Error("Cannot continue without authentication. " + e.message);
    }


    // ====================================================================
    // STEP 2: CREATE — Build the full load balancer stack
    // ====================================================================
    System.log("");
    System.log("--- STEP 2: CREATE ---");

    // 2a. Create Health Monitor
    try {
        var hmResult = createHealthMonitor(
            restHost,
            config.apiVersion,
            hmName,
            "HEALTH_MONITOR_HTTP",
            10,   // send_interval
            4,    // receive_timeout
            3,    // failed_checks
            2,    // successful_checks
            "GET / HTTP/1.0",
            ["HTTP_2XX", "HTTP_3XX"]
        );

        if (hmResult.success) {
            createdUuids.healthMonitor = hmResult.uuid;
            logStep("2a. Health Monitor", "CREATE", true, hmName + " (UUID: " + hmResult.uuid + ")");
        } else {
            logStep("2a. Health Monitor", "CREATE", false, "Status: " + hmResult.statusCode);
        }
    } catch (e) {
        logStep("2a. Health Monitor", "CREATE", false, "ERROR: " + e.message);
    }

    // 2b. Create Pool with 2 backend servers
    try {
        var servers = [
            { ip: config.server1Ip, port: config.serverPort },
            { ip: config.server2Ip, port: config.serverPort }
        ];

        // Attach health monitor if created
        var hmRef = createdUuids.healthMonitor ? "/api/healthmonitor/" + createdUuids.healthMonitor : null;

        var poolResult = createPool(
            restHost,
            config.apiVersion,
            poolName,
            servers,
            config.serverPort,
            "LB_ALGORITHM_ROUND_ROBIN",
            hmRef,
            config.cloudRef || null
        );

        if (poolResult.success) {
            createdUuids.pool = poolResult.uuid;
            logStep("2b. Pool", "CREATE", true, poolName + " with " + servers.length + " servers (UUID: " + poolResult.uuid + ")");
        } else {
            logStep("2b. Pool", "CREATE", false, "Status: " + poolResult.statusCode);
        }
    } catch (e) {
        logStep("2b. Pool", "CREATE", false, "ERROR: " + e.message);
    }

    // 2c. Create VsVip (Virtual IP)
    try {
        var vipResult = createVsVip(
            restHost,
            config.apiVersion,
            vipName,
            config.vipAddress,
            config.subnetMask,
            null,   // auto-derive subnet
            config.cloudRef || null,
            null    // VRF ref
        );

        if (vipResult.success) {
            createdUuids.vsVip = vipResult.uuid;
            logStep("2c. VsVip", "CREATE", true, vipName + " (VIP: " + config.vipAddress + ", UUID: " + vipResult.uuid + ")");
        } else {
            logStep("2c. VsVip", "CREATE", false, "Status: " + vipResult.statusCode);
        }
    } catch (e) {
        logStep("2c. VsVip", "CREATE", false, "ERROR: " + e.message);
    }

    // 2d. Create Virtual Service (ties Pool + VsVip together)
    try {
        if (!createdUuids.vsVip || !createdUuids.pool) {
            throw new Error("Cannot create VS — missing VsVip or Pool (skipped due to earlier failure).");
        }

        var vsResult = createVirtualService(
            restHost,
            config.apiVersion,
            vsName,
            "/api/vsvip/" + createdUuids.vsVip,
            "/api/pool/" + createdUuids.pool,
            config.servicePort,
            "TCP",
            null, // application profile (system default)
            null, // network profile
            false, // SSL disabled
            null,  // SSL profile
            null,  // SSL cert
            config.cloudRef || null,
            null   // SE group
        );

        if (vsResult.success) {
            createdUuids.virtualService = vsResult.uuid;
            logStep("2d. Virtual Service", "CREATE", true, vsName + " (Port: " + config.servicePort + ", UUID: " + vsResult.uuid + ")");
        } else {
            logStep("2d. Virtual Service", "CREATE", false, "Status: " + vsResult.statusCode);
        }
    } catch (e) {
        logStep("2d. Virtual Service", "CREATE", false, "ERROR: " + e.message);
    }


    // ====================================================================
    // STEP 3: READ — Verify all created objects
    // ====================================================================
    System.log("");
    System.log("--- STEP 3: READ (Verify Creation) ---");

    // 3a. Read Health Monitor
    try {
        var hmRead = getHealthMonitor(restHost, config.apiVersion, hmName);
        logStep("3a. Health Monitor", "READ", !!hmRead, hmRead ? "Type: " + hmRead.type + ", Interval: " + hmRead.send_interval + "s" : "NOT FOUND");
    } catch (e) {
        logStep("3a. Health Monitor", "READ", false, "ERROR: " + e.message);
    }

    // 3b. Read Pool
    try {
        var poolRead = getPool(restHost, config.apiVersion, poolName);
        var serverCount = (poolRead && poolRead.servers) ? poolRead.servers.length : 0;
        logStep("3b. Pool", "READ", !!poolRead, poolRead ? "Algorithm: " + poolRead.lb_algorithm + ", Servers: " + serverCount : "NOT FOUND");
    } catch (e) {
        logStep("3b. Pool", "READ", false, "ERROR: " + e.message);
    }

    // 3c. Read VsVip
    try {
        var vipRead = getVsVip(restHost, config.apiVersion, vipName);
        var vipAddr = (vipRead && vipRead.vip && vipRead.vip.length > 0) ? vipRead.vip[0].ip_address.addr : "N/A";
        logStep("3c. VsVip", "READ", !!vipRead, vipRead ? "VIP: " + vipAddr : "NOT FOUND");
    } catch (e) {
        logStep("3c. VsVip", "READ", false, "ERROR: " + e.message);
    }

    // 3d. Read Virtual Service
    try {
        var vsRead = getVirtualService(restHost, config.apiVersion, vsName);
        var vsPort = (vsRead && vsRead.services && vsRead.services.length > 0) ? vsRead.services[0].port : "N/A";
        logStep("3d. Virtual Service", "READ", !!vsRead, vsRead ? "Port: " + vsPort + ", Enabled: " + vsRead.enabled : "NOT FOUND");
    } catch (e) {
        logStep("3d. Virtual Service", "READ", false, "ERROR: " + e.message);
    }

    // 3e. List all objects (shows the demo objects alongside any existing ones)
    try {
        System.log("");
        System.log("--- Listing all AVI objects ---");
        var allHMs = listHealthMonitors(restHost, config.apiVersion);
        logStep("3e. List Health Monitors", "LIST", true, "Total: " + allHMs.length);

        var allPools = listPools(restHost, config.apiVersion);
        logStep("3e. List Pools", "LIST", true, "Total: " + allPools.length);

        var allVips = listVsVips(restHost, config.apiVersion);
        logStep("3e. List VsVips", "LIST", true, "Total: " + allVips.length);

        var allVSs = listVirtualServices(restHost, config.apiVersion);
        logStep("3e. List Virtual Services", "LIST", true, "Total: " + allVSs.length);
    } catch (e) {
        logStep("3e. List All", "LIST", false, "ERROR: " + e.message);
    }


    // ====================================================================
    // STEP 4: UPDATE — Modify the pool
    // ====================================================================
    System.log("");
    System.log("--- STEP 4: UPDATE ---");

    // 4a. Add a third server to the pool
    if (config.server3Ip && config.server3Ip.trim() !== "" && createdUuids.pool) {
        try {
            var addResult = addServerToPool(restHost, config.apiVersion, createdUuids.pool, config.server3Ip, config.serverPort);
            logStep("4a. Add Server to Pool", "UPDATE", addResult.success,
                     "Added " + config.server3Ip + ":" + config.serverPort + " → Total servers: " + addResult.totalServers);
        } catch (e) {
            logStep("4a. Add Server to Pool", "UPDATE", false, "ERROR: " + e.message);
        }
    } else {
        logStep("4a. Add Server to Pool", "SKIP", true, "No server3Ip provided or pool not created.");
    }

    // 4b. Change LB algorithm from Round Robin to Least Connections
    if (createdUuids.pool) {
        try {
            var updateResult = updatePool(restHost, config.apiVersion, createdUuids.pool, {
                "lb_algorithm": "LB_ALGORITHM_LEAST_CONNECTIONS",
                "description": "Updated by vRO Automation — LB algorithm changed"
            });
            logStep("4b. Update Pool Algorithm", "UPDATE", updateResult.success,
                     "Changed to LB_ALGORITHM_LEAST_CONNECTIONS");
        } catch (e) {
            logStep("4b. Update Pool Algorithm", "UPDATE", false, "ERROR: " + e.message);
        }
    }

    // 4c. Verify the updates by re-reading the pool
    if (createdUuids.pool) {
        try {
            var poolUpdated = getPool(restHost, config.apiVersion, poolName);
            var updatedServerCount = (poolUpdated && poolUpdated.servers) ? poolUpdated.servers.length : 0;
            logStep("4c. Verify Pool Update", "READ", !!poolUpdated,
                     "Algorithm: " + (poolUpdated ? poolUpdated.lb_algorithm : "N/A") +
                     ", Servers: " + updatedServerCount);
        } catch (e) {
            logStep("4c. Verify Pool Update", "READ", false, "ERROR: " + e.message);
        }
    }


    // ====================================================================
    // STEP 5: DELETE — Tear down in reverse order
    // ====================================================================
    System.log("");
    System.log("--- STEP 5: DELETE (Cleanup) ---");
    System.log("  (Deleting in reverse dependency order: VS → VsVip → Pool → HM)");

    // 5a. Delete Virtual Service FIRST (it references VsVip and Pool)
    if (createdUuids.virtualService) {
        try {
            var vsDelete = deleteVirtualService(restHost, config.apiVersion, createdUuids.virtualService);
            logStep("5a. Virtual Service", "DELETE", vsDelete.success, "UUID: " + createdUuids.virtualService);
        } catch (e) {
            logStep("5a. Virtual Service", "DELETE", false, "ERROR: " + e.message);
        }
    }

    // 5b. Delete VsVip
    if (createdUuids.vsVip) {
        try {
            var vipDelete = deleteVsVip(restHost, config.apiVersion, createdUuids.vsVip);
            logStep("5b. VsVip", "DELETE", vipDelete.success, "UUID: " + createdUuids.vsVip);
        } catch (e) {
            logStep("5b. VsVip", "DELETE", false, "ERROR: " + e.message);
        }
    }

    // 5c. Delete Pool
    if (createdUuids.pool) {
        try {
            var poolDelete = deletePool(restHost, config.apiVersion, createdUuids.pool);
            logStep("5c. Pool", "DELETE", poolDelete.success, "UUID: " + createdUuids.pool);
        } catch (e) {
            logStep("5c. Pool", "DELETE", false, "ERROR: " + e.message);
        }
    }

    // 5d. Delete Health Monitor
    if (createdUuids.healthMonitor) {
        try {
            var hmDelete = deleteHealthMonitor(restHost, config.apiVersion, createdUuids.healthMonitor);
            logStep("5d. Health Monitor", "DELETE", hmDelete.success, "UUID: " + createdUuids.healthMonitor);
        } catch (e) {
            logStep("5d. Health Monitor", "DELETE", false, "ERROR: " + e.message);
        }
    }


    // ====================================================================
    // STEP 6: LOGOUT
    // ====================================================================
    System.log("");
    System.log("--- STEP 6: LOGOUT ---");

    try {
        aviLogout(restHost);
        logStep("6. LOGOUT", "POST /logout", true, "Session ended.");
    } catch (e) {
        logStep("6. LOGOUT", "POST /logout", false, "WARNING: " + e.message);
    }


    // ====================================================================
    // SUMMARY
    // ====================================================================
    System.log("");
    System.log("================================================================");
    System.log("  AVI CRUD DEMO — SUMMARY");
    System.log("================================================================");

    var successCount = 0;
    var failCount = 0;
    for (var i = 0; i < results.length; i++) {
        if (results[i].success) {
            successCount++;
        } else {
            failCount++;
        }
    }

    System.log("  Total operations: " + results.length);
    System.log("  Succeeded: " + successCount);
    System.log("  Failed: " + failCount);
    System.log("================================================================");

    // Set workflow output
    var demoResult = JSON.stringify({
        summary: {
            controller: config.controllerIp,
            totalOps: results.length,
            succeeded: successCount,
            failed: failCount
        },
        operations: results
    }, null, 2);

    System.log("[aviCrudDemoWorkflow] Output:\n" + demoResult);

    // Return output (bind to workflow output parameter "demoResult")
    return demoResult;

})();
