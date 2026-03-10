/**
 * F5 BIG-IP LTM CRUD Demo — vRO Orchestration Workflow
 * =======================================================
 * End-to-end workflow demonstrating full CRUD lifecycle for
 * F5 BIG-IP LTM objects via the iControl REST API from vRO.
 *
 * Designed to be invoked from ServiceNow via the vRO REST API:
 *   POST /vco/api/workflows/<workflow-id>/executions
 *   Body: { "parameters": [{ "value": { "string": { "value": "<json>" }},
 *           "type": "string", "name": "f5RequestPayload" }] }
 *
 * Flow:
 *   1. LOGIN          → Token-based auth to F5 BIG-IP
 *   2. CREATE          → Node(s) → Monitor → Pool → iRule → Virtual Server
 *   3. READ            → List and verify all created objects
 *   4. UPDATE          → Add pool member, change LB mode, attach iRule
 *   5. READ (verify)   → Re-read updated objects
 *   6. DELETE           → VS → iRule → Pool → Monitor → Node(s)
 *   7. LOGOUT          → Invalidate auth token
 *
 * @module com.f5.bigip.demo
 * @version 1.0.0
 * @compatible VCF 9 / vRO 8.x
 *
 * ========================================================================
 * WORKFLOW INPUTS (configure in vRO Workflow Designer):
 * ========================================================================
 *
 * Option A — Individual parameters (for direct vRO runs):
 *   bigIpHost       (string)       - F5 BIG-IP management IP or FQDN
 *   username         (string)       - Admin username
 *   password         (SecureString) - Admin password
 *   vipAddress       (string)       - Virtual IP for demo VS (e.g., "10.0.1.100")
 *   servicePort      (number)       - VS listening port (default: 80)
 *   server1Ip        (string)       - Backend server 1 IP (e.g., "10.0.1.10")
 *   server2Ip        (string)       - Backend server 2 IP (e.g., "10.0.1.11")
 *   server3Ip        (string)       - Backend server 3 IP (for UPDATE step)
 *   serverPort       (number)       - Backend port (default: 80)
 *   partition        (string)       - F5 partition (default: "Common")
 *
 * Option B — Single JSON payload (for ServiceNow invocation):
 *   f5RequestPayload (string)       - JSON string containing all the above.
 *                                      ServiceNow catalog sends this via vRO API.
 *
 * WORKFLOW OUTPUT:
 *   demoResult       (string)       - JSON summary of all operations
 * ========================================================================
 *
 * Dependencies (vRO Actions — import all from /actions/ folder):
 *   - f5Auth.js              → f5Login, f5Logout, f5RefreshToken, f5MakeRequest, f5BuildUri
 *   - f5Node.js              → f5CreateNode, f5GetNode, f5DeleteNode, f5ListNodes
 *   - f5Monitor.js           → f5CreateMonitor, f5GetMonitor, f5DeleteMonitor, f5ListMonitors
 *   - f5Pool.js              → f5CreatePool, f5GetPool, f5UpdatePool, f5AddPoolMember,
 *                               f5RemovePoolMember, f5DeletePool, f5ListPools, f5GetPoolMembers
 *   - f5VirtualServer.js     → f5CreateVirtualServer, f5GetVirtualServer, f5UpdateVirtualServer,
 *                               f5DeleteVirtualServer, f5ListVirtualServers
 *   - f5iRule.js             → f5CreateiRule, f5GetiRule, f5DeleteiRule, f5AttachiRuleToVS
 */


// ========================================================================
// MAIN WORKFLOW
// ========================================================================

(function () {

    // ====================================================================
    // CONFIGURATION — Parse inputs (supports both direct params and JSON)
    // ====================================================================

    var config = {};

    // Option B: ServiceNow sends a single JSON payload string
    if (typeof f5RequestPayload !== "undefined" && f5RequestPayload && f5RequestPayload.trim() !== "") {
        System.log("[f5CrudDemo] Parsing f5RequestPayload from ServiceNow...");
        try {
            config = JSON.parse(f5RequestPayload);
        } catch (e) {
            throw new Error("Failed to parse f5RequestPayload JSON: " + e.message);
        }
    } else {
        // Option A: Individual workflow input parameters
        config = {
            bigIpHost:    bigIpHost,
            username:     username,
            password:     password,
            vipAddress:   vipAddress,
            servicePort:  servicePort || 80,
            server1Ip:    server1Ip,
            server2Ip:    server2Ip,
            server3Ip:    server3Ip || "",
            serverPort:   serverPort || 80,
            partition:    partition || "Common"
        };
    }

    // Apply defaults
    config.servicePort = config.servicePort || 80;
    config.serverPort  = config.serverPort || 80;
    config.partition   = config.partition || "Common";

    // Demo naming convention
    var DEMO_PREFIX = "vRO-Demo-";
    var node1Name     = DEMO_PREFIX + "Node-01";
    var node2Name     = DEMO_PREFIX + "Node-02";
    var node3Name     = DEMO_PREFIX + "Node-03";
    var monitorName   = DEMO_PREFIX + "Monitor-HTTP";
    var poolName      = DEMO_PREFIX + "Pool";
    var iRuleName     = DEMO_PREFIX + "iRule-XFF";
    var vsName        = DEMO_PREFIX + "VirtualServer";

    // Track created objects for cleanup
    var created = {
        node1: false, node2: false, node3: false,
        monitor: false, pool: false, iRule: false, vs: false
    };

    // Results log
    var results = [];

    function logStep(step, operation, success, details) {
        var entry = {
            step: step,
            operation: operation,
            success: success,
            details: details,
            timestamp: new Date().toISOString()
        };
        results.push(entry);
        var icon = success ? "+" : "x";
        System.log("  [" + icon + "] " + step + " | " + operation + " | " + details);
    }


    // ====================================================================
    // STEP 1: LOGIN
    // ====================================================================
    System.log("================================================================");
    System.log("  F5 BIG-IP LTM CRUD Demo - Starting");
    System.log("  Host: " + config.bigIpHost);
    System.log("  Partition: " + config.partition);
    System.log("================================================================");

    var session = null;
    try {
        session = f5Login(config.bigIpHost, config.username, config.password);
        // Extend token timeout for the demo
        f5RefreshToken(session, 3600);
        logStep("1. LOGIN", "POST /mgmt/shared/authn/login", true, "Token acquired for " + config.bigIpHost);
    } catch (e) {
        logStep("1. LOGIN", "POST /mgmt/shared/authn/login", false, "FAILED: " + e.message);
        throw new Error("Cannot continue without authentication. " + e.message);
    }


    // ====================================================================
    // STEP 2: CREATE — Build the full LTM stack
    // ====================================================================
    System.log("");
    System.log("--- STEP 2: CREATE ---");

    // 2a. Create Nodes (backend servers — F5 requires nodes before pool members)
    try {
        var n1 = f5CreateNode(session, node1Name, config.server1Ip, config.partition);
        created.node1 = n1.success;
        logStep("2a. Node 1", "CREATE", n1.success, node1Name + " (" + config.server1Ip + ")");
    } catch (e) {
        logStep("2a. Node 1", "CREATE", false, "ERROR: " + e.message);
    }

    try {
        var n2 = f5CreateNode(session, node2Name, config.server2Ip, config.partition);
        created.node2 = n2.success;
        logStep("2a. Node 2", "CREATE", n2.success, node2Name + " (" + config.server2Ip + ")");
    } catch (e) {
        logStep("2a. Node 2", "CREATE", false, "ERROR: " + e.message);
    }

    // 2b. Create HTTP Health Monitor
    try {
        var mon = f5CreateMonitor(
            session, monitorName, "http",
            5,    // interval (seconds)
            16,   // timeout (3*5+1 = 16, F5 best practice)
            "GET / HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n",
            "200 OK",
            config.partition
        );
        created.monitor = mon.success;
        logStep("2b. Monitor", "CREATE", mon.success, monitorName + " (HTTP, interval:5s, timeout:16s)");
    } catch (e) {
        logStep("2b. Monitor", "CREATE", false, "ERROR: " + e.message);
    }

    // 2c. Create Pool with 2 members + monitor
    try {
        var members = [
            { name: node1Name, address: config.server1Ip, port: config.serverPort },
            { name: node2Name, address: config.server2Ip, port: config.serverPort }
        ];

        var monRef = created.monitor ? monitorName : null;

        var poolResult = f5CreatePool(
            session, poolName, "round-robin",
            monRef, members, config.partition, "none"
        );
        created.pool = poolResult.success;
        logStep("2c. Pool", "CREATE", poolResult.success,
                poolName + " (2 members, round-robin, monitor: " + (monRef || "none") + ")");
    } catch (e) {
        logStep("2c. Pool", "CREATE", false, "ERROR: " + e.message);
    }

    // 2d. Create iRule (X-Forwarded-For header insertion)
    try {
        var iRuleBody = f5GetXForwardedForiRule();
        var iRuleResult = f5CreateiRule(session, iRuleName, iRuleBody, config.partition);
        created.iRule = iRuleResult.success;
        logStep("2d. iRule", "CREATE", iRuleResult.success, iRuleName + " (X-Forwarded-For insertion)");
    } catch (e) {
        logStep("2d. iRule", "CREATE", false, "ERROR: " + e.message);
    }

    // 2e. Create Virtual Server (ties everything together)
    try {
        if (!created.pool) {
            throw new Error("Cannot create VS — pool creation failed.");
        }

        var vsDestination = config.vipAddress + ":" + config.servicePort;
        var vsProfiles = [
            { "name": "http" },
            { "name": "tcp" }
        ];

        var vsResult = f5CreateVirtualServer(
            session, vsName, vsDestination, "255.255.255.255",
            poolName, vsProfiles, "automap",
            "source_addr",   // persistence
            null,            // iRules (attach separately in UPDATE step)
            config.partition,
            "tcp"
        );
        created.vs = vsResult.success;
        logStep("2e. Virtual Server", "CREATE", vsResult.success,
                vsName + " (" + vsDestination + " → " + poolName + ")");
    } catch (e) {
        logStep("2e. Virtual Server", "CREATE", false, "ERROR: " + e.message);
    }


    // ====================================================================
    // STEP 3: READ — Verify all created objects
    // ====================================================================
    System.log("");
    System.log("--- STEP 3: READ (Verify Creation) ---");

    try {
        var n1Read = f5GetNode(session, node1Name, config.partition);
        logStep("3a. Node 1", "READ", !!n1Read,
                n1Read ? n1Read.fullPath + " (Addr: " + n1Read.address + ", State: " + n1Read.state + ")" : "NOT FOUND");
    } catch (e) { logStep("3a. Node 1", "READ", false, "ERROR: " + e.message); }

    try {
        var monRead = f5GetMonitor(session, monitorName, "http", config.partition);
        logStep("3b. Monitor", "READ", !!monRead,
                monRead ? monRead.fullPath + " (interval: " + monRead.interval + "s)" : "NOT FOUND");
    } catch (e) { logStep("3b. Monitor", "READ", false, "ERROR: " + e.message); }

    try {
        var poolRead = f5GetPool(session, poolName, config.partition, true);
        var memberCount = (poolRead && poolRead.membersReference && poolRead.membersReference.items)
                          ? poolRead.membersReference.items.length : 0;
        logStep("3c. Pool", "READ", !!poolRead,
                poolRead ? poolRead.fullPath + " (LB: " + poolRead.loadBalancingMode + ", Members: " + memberCount + ")" : "NOT FOUND");
    } catch (e) { logStep("3c. Pool", "READ", false, "ERROR: " + e.message); }

    try {
        var iRuleRead = f5GetiRule(session, iRuleName, config.partition);
        logStep("3d. iRule", "READ", !!iRuleRead,
                iRuleRead ? iRuleRead.fullPath : "NOT FOUND");
    } catch (e) { logStep("3d. iRule", "READ", false, "ERROR: " + e.message); }

    try {
        var vsRead = f5GetVirtualServer(session, vsName, config.partition);
        logStep("3e. Virtual Server", "READ", !!vsRead,
                vsRead ? vsRead.fullPath + " (Dest: " + vsRead.destination + ", Enabled: " + vsRead.enabled + ")" : "NOT FOUND");
    } catch (e) { logStep("3e. Virtual Server", "READ", false, "ERROR: " + e.message); }

    // 3f. List all objects
    try {
        System.log("");
        System.log("--- Listing all F5 LTM objects ---");
        var allNodes = f5ListNodes(session, config.partition);
        logStep("3f. List Nodes", "LIST", true, "Total: " + allNodes.length);

        var allMonitors = f5ListMonitors(session, "http");
        logStep("3f. List HTTP Monitors", "LIST", true, "Total: " + allMonitors.length);

        var allPools = f5ListPools(session, config.partition);
        logStep("3f. List Pools", "LIST", true, "Total: " + allPools.length);

        var allVSs = f5ListVirtualServers(session, config.partition);
        logStep("3f. List Virtual Servers", "LIST", true, "Total: " + allVSs.length);
    } catch (e) { logStep("3f. List All", "LIST", false, "ERROR: " + e.message); }


    // ====================================================================
    // STEP 4: UPDATE — Modify objects
    // ====================================================================
    System.log("");
    System.log("--- STEP 4: UPDATE ---");

    // 4a. Add a 3rd node + pool member
    if (config.server3Ip && config.server3Ip.trim() !== "" && created.pool) {
        try {
            var n3 = f5CreateNode(session, node3Name, config.server3Ip, config.partition);
            created.node3 = n3.success;
            logStep("4a. Node 3", "CREATE", n3.success, node3Name + " (" + config.server3Ip + ")");

            var addMember = f5AddPoolMember(session, poolName, node3Name, config.serverPort, config.partition);
            logStep("4a. Add Member to Pool", "UPDATE", addMember.success,
                     "Added " + node3Name + ":" + config.serverPort);
        } catch (e) {
            logStep("4a. Add Member", "UPDATE", false, "ERROR: " + e.message);
        }
    } else {
        logStep("4a. Add Member", "SKIP", true, "No server3Ip provided or pool not created.");
    }

    // 4b. Change LB algorithm to least-connections-member
    if (created.pool) {
        try {
            var lbUpdate = f5UpdatePool(session, poolName, {
                "loadBalancingMode": "least-connections-member",
                "description": "Updated by vRO — LB mode changed"
            }, config.partition);
            logStep("4b. Update Pool LB", "UPDATE", lbUpdate.success,
                     "Changed to least-connections-member");
        } catch (e) {
            logStep("4b. Update Pool LB", "UPDATE", false, "ERROR: " + e.message);
        }
    }

    // 4c. Attach iRule to Virtual Server
    if (created.vs && created.iRule) {
        try {
            var iRulePath = "/" + config.partition + "/" + iRuleName;
            var attachResult = f5AttachiRuleToVS(session, vsName, iRulePath, config.partition);
            logStep("4c. Attach iRule to VS", "UPDATE", attachResult.success,
                     "Attached " + iRulePath + " to " + vsName);
        } catch (e) {
            logStep("4c. Attach iRule", "UPDATE", false, "ERROR: " + e.message);
        }
    }

    // 4d. Verify updates
    if (created.pool) {
        try {
            var poolVerify = f5GetPool(session, poolName, config.partition, true);
            var verifyMembers = (poolVerify && poolVerify.membersReference && poolVerify.membersReference.items)
                                ? poolVerify.membersReference.items.length : 0;
            logStep("4d. Verify Pool Update", "READ", !!poolVerify,
                     "LB: " + (poolVerify ? poolVerify.loadBalancingMode : "N/A") + ", Members: " + verifyMembers);
        } catch (e) {
            logStep("4d. Verify Pool", "READ", false, "ERROR: " + e.message);
        }
    }


    // ====================================================================
    // STEP 5: DELETE — Tear down in reverse dependency order
    // ====================================================================
    System.log("");
    System.log("--- STEP 5: DELETE (Cleanup) ---");
    System.log("  (Order: VS → Pool → Monitor → Nodes, iRule)");

    // 5a. Delete Virtual Server FIRST
    if (created.vs) {
        try {
            var vsDel = f5DeleteVirtualServer(session, vsName, config.partition);
            logStep("5a. Virtual Server", "DELETE", vsDel.success, vsName);
        } catch (e) { logStep("5a. Virtual Server", "DELETE", false, "ERROR: " + e.message); }
    }

    // 5b. Delete Pool (members are removed with the pool)
    if (created.pool) {
        try {
            var poolDel = f5DeletePool(session, poolName, config.partition);
            logStep("5b. Pool", "DELETE", poolDel.success, poolName);
        } catch (e) { logStep("5b. Pool", "DELETE", false, "ERROR: " + e.message); }
    }

    // 5c. Delete Monitor
    if (created.monitor) {
        try {
            var monDel = f5DeleteMonitor(session, monitorName, "http", config.partition);
            logStep("5c. Monitor", "DELETE", monDel.success, monitorName);
        } catch (e) { logStep("5c. Monitor", "DELETE", false, "ERROR: " + e.message); }
    }

    // 5d. Delete iRule
    if (created.iRule) {
        try {
            var iRuleDel = f5DeleteiRule(session, iRuleName, config.partition);
            logStep("5d. iRule", "DELETE", iRuleDel.success, iRuleName);
        } catch (e) { logStep("5d. iRule", "DELETE", false, "ERROR: " + e.message); }
    }

    // 5e. Delete Nodes
    if (created.node1) {
        try {
            var n1Del = f5DeleteNode(session, node1Name, config.partition);
            logStep("5e. Node 1", "DELETE", n1Del.success, node1Name);
        } catch (e) { logStep("5e. Node 1", "DELETE", false, "ERROR: " + e.message); }
    }
    if (created.node2) {
        try {
            var n2Del = f5DeleteNode(session, node2Name, config.partition);
            logStep("5e. Node 2", "DELETE", n2Del.success, node2Name);
        } catch (e) { logStep("5e. Node 2", "DELETE", false, "ERROR: " + e.message); }
    }
    if (created.node3) {
        try {
            var n3Del = f5DeleteNode(session, node3Name, config.partition);
            logStep("5e. Node 3", "DELETE", n3Del.success, node3Name);
        } catch (e) { logStep("5e. Node 3", "DELETE", false, "ERROR: " + e.message); }
    }


    // ====================================================================
    // STEP 6: LOGOUT
    // ====================================================================
    System.log("");
    System.log("--- STEP 6: LOGOUT ---");
    try {
        f5Logout(session);
        logStep("6. LOGOUT", "DELETE /mgmt/shared/authz/tokens", true, "Token invalidated.");
    } catch (e) {
        logStep("6. LOGOUT", "DELETE token", false, "WARNING: " + e.message);
    }


    // ====================================================================
    // SUMMARY
    // ====================================================================
    System.log("");
    System.log("================================================================");
    System.log("  F5 BIG-IP CRUD DEMO - SUMMARY");
    System.log("================================================================");

    var successCount = 0;
    var failCount = 0;
    for (var i = 0; i < results.length; i++) {
        if (results[i].success) { successCount++; } else { failCount++; }
    }

    System.log("  Total operations: " + results.length);
    System.log("  Succeeded: " + successCount);
    System.log("  Failed: " + failCount);
    System.log("================================================================");

    // Build output JSON (returned to ServiceNow as workflow output)
    var demoResult = JSON.stringify({
        summary: {
            bigIpHost: config.bigIpHost,
            partition: config.partition,
            totalOps: results.length,
            succeeded: successCount,
            failed: failCount
        },
        operations: results
    }, null, 2);

    System.log("[f5CrudDemoWorkflow] Output:\n" + demoResult);

    // Return (bind to workflow output parameter "demoResult")
    return demoResult;

})();
