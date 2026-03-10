/**
 * F5 BIG-IP Pool CRUD Actions
 * ==============================
 * Create, Read, Update, Delete operations for F5 LTM Pools and Pool Members.
 *
 * In F5, a Pool is a group of Nodes (servers) that receive traffic from a
 * Virtual Server. Pool Members are references to Nodes with port bindings.
 *
 * Key F5 Concepts:
 *   - Pool = group of backend servers + LB algorithm + health monitor(s)
 *   - Pool Member = Node:Port combination (e.g., "web-01:80")
 *   - Member name format: "/Common/node-name:port" or "node-name:port"
 *   - Members subcollection: /mgmt/tm/ltm/pool/~Common~pool-name/members
 *
 * Load Balancing Modes:
 *   - round-robin                    (default)
 *   - least-connections-member       (per member)
 *   - least-connections-node         (per node)
 *   - fastest-node
 *   - ratio-member / ratio-node
 *   - weighted-least-connections-member
 *   - predictive-member
 *   - observed-member
 *
 * @module com.f5.bigip.pool
 * @version 1.0.0
 * @compatible VCF 9 / vRO 8.x
 *
 * API Endpoint: /mgmt/tm/ltm/pool
 *
 * Dependencies:
 *   - f5Auth.js (f5MakeRequest, f5BuildUri)
 *   - f5Node.js (f5CreateNode — nodes must exist before adding as members)
 */


/**
 * --- Action: f5CreatePool ---
 * Creates a new Pool on the F5 BIG-IP.
 *
 * Inputs:
 *   session          (object) - Session from f5Login
 *   name             (string) - Pool name (e.g., "pool-webapp-prod")
 *   lbMode           (string) - Load balancing mode (default: "round-robin")
 *   monitorName      (string) - Monitor to attach (e.g., "/Common/mon-http-app1"). null = none.
 *   members          (Array)  - Array of member objects: [{ name: "web-01", address: "10.0.1.10", port: 80 }, ...]
 *                                If empty, creates a pool with no members.
 *   partition        (string) - Partition (default: "Common")
 *   serviceDownAction(string) - Action when all members down: "none", "reset", "reselect", "drop" (default: "none")
 *
 * Output:
 *   result (object) - { name, fullPath, success, statusCode }
 */
function f5CreatePool(session, name, lbMode, monitorName, members, partition, serviceDownAction) {

    // Input validation
    if (!name || name.trim() === "") {
        throw new Error("f5CreatePool: name is required.");
    }

    partition = partition || "Common";
    lbMode = lbMode || "round-robin";
    serviceDownAction = serviceDownAction || "none";

    System.log("[f5CreatePool] Creating pool: " + name + " (LB: " + lbMode + ")");

    // Build pool payload
    var payload = {
        "name": name,
        "partition": partition,
        "loadBalancingMode": lbMode,
        "serviceDownAction": serviceDownAction,
        "description": "Created by vRO Automation"
    };

    // Attach monitor if provided
    if (monitorName && monitorName.trim() !== "") {
        // F5 monitor ref format: "/Common/monitor-name"
        if (monitorName.indexOf("/") !== 0) {
            monitorName = "/" + partition + "/" + monitorName;
        }
        payload.monitor = monitorName;
        System.log("[f5CreatePool] Monitor attached: " + monitorName);
    }

    // Add members if provided
    if (members && members.length > 0) {
        var membersList = [];
        for (var i = 0; i < members.length; i++) {
            var m = members[i];
            if (!m.name && !m.address) {
                System.warn("[f5CreatePool] Skipping member at index " + i + " — no name or address.");
                continue;
            }

            var memberName = (m.name || m.address) + ":" + (m.port || 80);
            var memberObj = {
                "name": memberName,
                "address": m.address || m.name
            };

            membersList.push(memberObj);
            System.log("[f5CreatePool] Member " + (i + 1) + ": " + memberName);
        }

        if (membersList.length > 0) {
            payload.members = membersList;
        }
    }

    System.log("[f5CreatePool] Payload: " + JSON.stringify(payload));

    var response = f5MakeRequest(session, "POST", "/mgmt/tm/ltm/pool", JSON.stringify(payload));

    if (response.success) {
        System.log("[f5CreatePool] Created successfully: " + response.body.fullPath);
        return {
            name: response.body.name,
            fullPath: response.body.fullPath,
            success: true,
            statusCode: response.statusCode
        };
    } else {
        if (response.statusCode === 409) {
            System.warn("[f5CreatePool] Pool already exists: " + name);
            return { name: name, fullPath: "/" + partition + "/" + name, success: true, statusCode: 409 };
        }
        System.error("[f5CreatePool] Failed to create pool: " + name);
        return { name: name, fullPath: null, success: false, statusCode: response.statusCode };
    }
}


/**
 * --- Action: f5GetPool ---
 * Reads a Pool by name, including member subcollection.
 *
 * Inputs:
 *   session          (object) - Session from f5Login
 *   name             (string) - Pool name
 *   partition        (string) - Partition (default: "Common")
 *   expandMembers    (boolean)- Include member details (default: true)
 *
 * Output:
 *   result (object) - Full pool object from F5, or null if not found
 */
function f5GetPool(session, name, partition, expandMembers) {
    if (!name || name.trim() === "") {
        throw new Error("f5GetPool: name is required.");
    }
    partition = partition || "Common";
    expandMembers = (expandMembers !== false); // Default true

    System.log("[f5GetPool] Fetching pool: " + name);

    var uri = f5BuildUri("/mgmt/tm/ltm/pool", name, partition);
    if (expandMembers) {
        uri += "?expandSubcollections=true";
    }

    var response = f5MakeRequest(session, "GET", uri, null);

    if (response.success) {
        var pool = response.body;
        System.log("[f5GetPool] Found: " + pool.fullPath);
        System.log("[f5GetPool] LB Mode: " + pool.loadBalancingMode);
        System.log("[f5GetPool] Monitor: " + (pool.monitor || "none"));

        // Log members if available
        if (pool.membersReference && pool.membersReference.items) {
            var memberItems = pool.membersReference.items;
            System.log("[f5GetPool] Members: " + memberItems.length);
            for (var i = 0; i < memberItems.length; i++) {
                System.log("  Member " + (i + 1) + ": " + memberItems[i].fullPath +
                           " (State: " + memberItems[i].state + ", Session: " + memberItems[i].session + ")");
            }
        }

        return pool;
    }

    System.warn("[f5GetPool] Pool not found: " + name);
    return null;
}


/**
 * --- Action: f5UpdatePool ---
 * Updates an existing Pool (e.g., change LB algorithm, monitor, description).
 *
 * Inputs:
 *   session      (object) - Session from f5Login
 *   name         (string) - Pool name
 *   updateFields (object) - Fields to update. Examples:
 *     { "loadBalancingMode": "least-connections-member" }
 *     { "monitor": "/Common/new-monitor" }
 *     { "serviceDownAction": "reselect" }
 *   partition    (string) - Partition (default: "Common")
 *
 * Output:
 *   result (object) - { name, success, statusCode }
 */
function f5UpdatePool(session, name, updateFields, partition) {
    if (!name || name.trim() === "") {
        throw new Error("f5UpdatePool: name is required.");
    }
    if (!updateFields) {
        throw new Error("f5UpdatePool: updateFields is required.");
    }
    partition = partition || "Common";

    System.log("[f5UpdatePool] Updating pool: " + name);

    var uri = f5BuildUri("/mgmt/tm/ltm/pool", name, partition);
    var response = f5MakeRequest(session, "PATCH", uri, JSON.stringify(updateFields));

    if (response.success) {
        System.log("[f5UpdatePool] Updated successfully: " + name);
        return { name: response.body.name, success: true, statusCode: response.statusCode };
    } else {
        System.error("[f5UpdatePool] Update failed for: " + name);
        return { name: name, success: false, statusCode: response.statusCode };
    }
}


/**
 * --- Action: f5AddPoolMember ---
 * Adds a member (Node:Port) to an existing pool.
 * The node should already exist (use f5CreateNode first).
 *
 * Inputs:
 *   session    (object) - Session from f5Login
 *   poolName   (string) - Pool name
 *   nodeName   (string) - Node name or IP (e.g., "web-01" or "10.0.1.10")
 *   port       (number) - Service port (e.g., 80)
 *   partition  (string) - Partition (default: "Common")
 *
 * Output:
 *   result (object) - { memberName, success, statusCode }
 */
function f5AddPoolMember(session, poolName, nodeName, port, partition) {
    if (!poolName) throw new Error("f5AddPoolMember: poolName is required.");
    if (!nodeName) throw new Error("f5AddPoolMember: nodeName is required.");
    port = port || 80;
    partition = partition || "Common";

    var memberName = nodeName + ":" + port;
    System.log("[f5AddPoolMember] Adding " + memberName + " to pool " + poolName);

    var poolUri = f5BuildUri("/mgmt/tm/ltm/pool", poolName, partition);
    var membersEndpoint = poolUri + "/members";

    var payload = {
        "name": memberName,
        "address": nodeName
    };

    var response = f5MakeRequest(session, "POST", membersEndpoint, JSON.stringify(payload));

    if (response.success) {
        System.log("[f5AddPoolMember] Added successfully: " + memberName);
        return { memberName: memberName, success: true, statusCode: response.statusCode };
    } else {
        if (response.statusCode === 409) {
            System.warn("[f5AddPoolMember] Member already exists in pool: " + memberName);
            return { memberName: memberName, success: true, statusCode: 409 };
        }
        System.error("[f5AddPoolMember] Failed to add: " + memberName);
        return { memberName: memberName, success: false, statusCode: response.statusCode };
    }
}


/**
 * --- Action: f5RemovePoolMember ---
 * Removes a member from a pool. Does NOT delete the underlying node.
 *
 * Inputs:
 *   session    (object) - Session from f5Login
 *   poolName   (string) - Pool name
 *   nodeName   (string) - Node name
 *   port       (number) - Service port
 *   partition  (string) - Partition (default: "Common")
 *
 * Output:
 *   result (object) - { success, statusCode }
 */
function f5RemovePoolMember(session, poolName, nodeName, port, partition) {
    if (!poolName) throw new Error("f5RemovePoolMember: poolName is required.");
    if (!nodeName) throw new Error("f5RemovePoolMember: nodeName is required.");
    port = port || 80;
    partition = partition || "Common";

    var memberName = nodeName + ":" + port;
    System.log("[f5RemovePoolMember] Removing " + memberName + " from pool " + poolName);

    var poolUri = f5BuildUri("/mgmt/tm/ltm/pool", poolName, partition);
    var memberUri = poolUri + "/members/~" + partition + "~" + memberName;

    var response = f5MakeRequest(session, "DELETE", memberUri, null);

    if (response.success) {
        System.log("[f5RemovePoolMember] Removed: " + memberName);
        return { success: true, statusCode: response.statusCode };
    } else {
        System.error("[f5RemovePoolMember] Remove failed: " + memberName);
        return { success: false, statusCode: response.statusCode };
    }
}


/**
 * --- Action: f5EnableDisablePoolMember ---
 * Enable or disable a specific pool member (not the node).
 *
 * F5 Pool Member States:
 *   - "user-enabled"  → Member receives traffic
 *   - "user-disabled" → Member drains connections, then goes offline (graceful)
 *   - "forced-offline" → Immediately stops all traffic
 *
 * Inputs:
 *   session    (object)  - Session from f5Login
 *   poolName   (string)  - Pool name
 *   nodeName   (string)  - Node name
 *   port       (number)  - Port
 *   enabled    (boolean) - true = enable, false = disable
 *   partition  (string)  - Partition (default: "Common")
 *
 * Output:
 *   result (object) - { memberName, success }
 */
function f5EnableDisablePoolMember(session, poolName, nodeName, port, enabled, partition) {
    if (!poolName) throw new Error("f5EnableDisablePoolMember: poolName is required.");
    if (!nodeName) throw new Error("f5EnableDisablePoolMember: nodeName is required.");
    port = port || 80;
    partition = partition || "Common";

    var memberName = nodeName + ":" + port;
    var state = enabled ? "user-enabled" : "user-disabled";

    System.log("[f5EnableDisablePoolMember] Setting " + memberName + " in pool " + poolName + " to: " + state);

    var poolUri = f5BuildUri("/mgmt/tm/ltm/pool", poolName, partition);
    var memberUri = poolUri + "/members/~" + partition + "~" + memberName;

    var response = f5MakeRequest(session, "PATCH", memberUri, JSON.stringify({ "session": state }));

    if (response.success) {
        System.log("[f5EnableDisablePoolMember] Updated: " + memberName + " → " + state);
        return { memberName: memberName, success: true };
    } else {
        return { memberName: memberName, success: false };
    }
}


/**
 * --- Action: f5DeletePool ---
 * Deletes a Pool. Pool must not be referenced by a Virtual Server.
 *
 * Inputs:
 *   session    (object) - Session from f5Login
 *   name       (string) - Pool name
 *   partition  (string) - Partition (default: "Common")
 *
 * Output:
 *   result (object) - { success, statusCode }
 */
function f5DeletePool(session, name, partition) {
    if (!name || name.trim() === "") {
        throw new Error("f5DeletePool: name is required.");
    }
    partition = partition || "Common";

    System.log("[f5DeletePool] Deleting pool: " + name);

    var uri = f5BuildUri("/mgmt/tm/ltm/pool", name, partition);
    var response = f5MakeRequest(session, "DELETE", uri, null);

    if (response.success) {
        System.log("[f5DeletePool] Deleted: " + name);
        return { success: true, statusCode: response.statusCode };
    } else {
        System.error("[f5DeletePool] Delete failed for: " + name);
        return { success: false, statusCode: response.statusCode };
    }
}


/**
 * --- Action: f5ListPools ---
 * Lists all Pools on the F5 BIG-IP.
 *
 * Inputs:
 *   session    (object) - Session from f5Login
 *   partition  (string) - Partition filter (null = all)
 *
 * Output:
 *   result (Array) - Array of pool objects
 */
function f5ListPools(session, partition) {
    System.log("[f5ListPools] Fetching all pools...");

    var endpoint = "/mgmt/tm/ltm/pool";
    if (partition) {
        endpoint += "?$filter=partition%20eq%20" + partition;
    }

    var response = f5MakeRequest(session, "GET", endpoint, null);

    if (response.success && response.body && response.body.items) {
        var pools = response.body.items;
        System.log("[f5ListPools] Found " + pools.length + " pool(s).");
        for (var i = 0; i < pools.length; i++) {
            System.log("  [" + (i + 1) + "] " + pools[i].fullPath + " (LB: " + pools[i].loadBalancingMode + ", Monitor: " + (pools[i].monitor || "none") + ")");
        }
        return pools;
    }

    System.warn("[f5ListPools] No pools found.");
    return [];
}


/**
 * --- Action: f5GetPoolMembers ---
 * Gets all members of a specific pool with their status.
 *
 * Inputs:
 *   session    (object) - Session from f5Login
 *   poolName   (string) - Pool name
 *   partition  (string) - Partition (default: "Common")
 *
 * Output:
 *   result (Array) - Array of pool member objects
 */
function f5GetPoolMembers(session, poolName, partition) {
    if (!poolName) throw new Error("f5GetPoolMembers: poolName is required.");
    partition = partition || "Common";

    System.log("[f5GetPoolMembers] Fetching members of pool: " + poolName);

    var poolUri = f5BuildUri("/mgmt/tm/ltm/pool", poolName, partition);
    var response = f5MakeRequest(session, "GET", poolUri + "/members", null);

    if (response.success && response.body && response.body.items) {
        var members = response.body.items;
        System.log("[f5GetPoolMembers] Found " + members.length + " member(s).");
        for (var i = 0; i < members.length; i++) {
            System.log("  [" + (i + 1) + "] " + members[i].fullPath +
                       " (State: " + members[i].state + ", Session: " + members[i].session + ")");
        }
        return members;
    }

    System.warn("[f5GetPoolMembers] No members found in pool: " + poolName);
    return [];
}
