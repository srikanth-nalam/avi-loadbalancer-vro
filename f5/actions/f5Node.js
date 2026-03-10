/**
 * F5 BIG-IP Node CRUD Actions
 * =============================
 * Create, Read, Update, Delete operations for F5 LTM Nodes.
 *
 * In F5, a Node is the fundamental server object — it represents a physical
 * or virtual server by its IP address. Nodes must exist before they can be
 * added as Pool Members. This is a key architectural difference from AVI.
 *
 * F5 Architecture:  Node → Pool Member → Pool → Virtual Server
 * AVI Architecture: Server (inline in Pool) → Pool → VsVip → Virtual Service
 *
 * @module com.f5.bigip.node
 * @version 1.0.0
 * @compatible VCF 9 / vRO 8.x
 *
 * API Endpoint: /mgmt/tm/ltm/node
 *
 * Dependencies:
 *   - f5Auth.js (f5MakeRequest, f5BuildUri)
 */


/**
 * --- Action: f5CreateNode ---
 * Registers a new backend server (Node) on the F5 BIG-IP.
 *
 * Inputs:
 *   session    (object) - Session from f5Login
 *   name       (string) - Node name (e.g., "web-server-01")
 *   address    (string) - IP address (e.g., "10.0.1.10")
 *   partition  (string) - Partition (default: "Common")
 *   description(string) - Optional description
 *
 * Output:
 *   result (object) - { name, address, fullPath, success, statusCode }
 */
function f5CreateNode(session, name, address, partition, description) {
    // Input validation
    if (!name || name.trim() === "") {
        throw new Error("f5CreateNode: name is required.");
    }
    if (!address || address.trim() === "") {
        throw new Error("f5CreateNode: address is required.");
    }

    partition = partition || "Common";
    description = description || "Created by vRO Automation";

    System.log("[f5CreateNode] Creating node: " + name + " (" + address + ") in /" + partition);

    var payload = {
        "name": name,
        "partition": partition,
        "address": address,
        "description": description
    };

    var response = f5MakeRequest(session, "POST", "/mgmt/tm/ltm/node", JSON.stringify(payload));

    if (response.success) {
        System.log("[f5CreateNode] Created successfully: " + response.body.fullPath);
        return {
            name: response.body.name,
            address: response.body.address,
            fullPath: response.body.fullPath,
            success: true,
            statusCode: response.statusCode
        };
    } else {
        // Check if node already exists (409 Conflict)
        if (response.statusCode === 409) {
            System.warn("[f5CreateNode] Node already exists: " + name + ". Proceeding.");
            return {
                name: name,
                address: address,
                fullPath: "/" + partition + "/" + name,
                success: true,
                statusCode: response.statusCode
            };
        }
        System.error("[f5CreateNode] Failed to create node: " + name);
        return { name: name, address: address, fullPath: null, success: false, statusCode: response.statusCode };
    }
}


/**
 * --- Action: f5GetNode ---
 * Reads a Node by name.
 *
 * Inputs:
 *   session    (object) - Session from f5Login
 *   name       (string) - Node name
 *   partition  (string) - Partition (default: "Common")
 *
 * Output:
 *   result (object) - Full node object from F5, or null if not found
 */
function f5GetNode(session, name, partition) {
    if (!name || name.trim() === "") {
        throw new Error("f5GetNode: name is required.");
    }
    partition = partition || "Common";

    System.log("[f5GetNode] Fetching node: " + name + " in /" + partition);

    var uri = f5BuildUri("/mgmt/tm/ltm/node", name, partition);
    var response = f5MakeRequest(session, "GET", uri, null);

    if (response.success) {
        System.log("[f5GetNode] Found: " + response.body.fullPath + " (Address: " + response.body.address + ")");
        System.log("[f5GetNode] State: " + response.body.state + ", Session: " + response.body.session);
        return response.body;
    }

    System.warn("[f5GetNode] Node not found: " + name);
    return null;
}


/**
 * --- Action: f5UpdateNode ---
 * Updates an existing Node (e.g., enable/disable, change description).
 *
 * Inputs:
 *   session      (object) - Session from f5Login
 *   name         (string) - Node name
 *   updateFields (object) - Fields to update. Examples:
 *     { "session": "user-disabled" }     // Disable the node
 *     { "session": "user-enabled" }      // Enable the node
 *     { "description": "Updated desc" }  // Change description
 *     { "connectionLimit": 100 }         // Set max connections
 *   partition    (string) - Partition (default: "Common")
 *
 * Output:
 *   result (object) - { name, success, statusCode }
 */
function f5UpdateNode(session, name, updateFields, partition) {
    if (!name || name.trim() === "") {
        throw new Error("f5UpdateNode: name is required.");
    }
    if (!updateFields) {
        throw new Error("f5UpdateNode: updateFields is required.");
    }
    partition = partition || "Common";

    System.log("[f5UpdateNode] Updating node: " + name);

    var uri = f5BuildUri("/mgmt/tm/ltm/node", name, partition);

    // Use PATCH for partial update (F5 best practice — unlike AVI which requires full PUT)
    var response = f5MakeRequest(session, "PATCH", uri, JSON.stringify(updateFields));

    if (response.success) {
        System.log("[f5UpdateNode] Updated successfully: " + response.body.fullPath);
        return { name: response.body.name, success: true, statusCode: response.statusCode };
    } else {
        System.error("[f5UpdateNode] Update failed for: " + name);
        return { name: name, success: false, statusCode: response.statusCode };
    }
}


/**
 * --- Action: f5DeleteNode ---
 * Deletes a Node. Node must not be a member of any pool.
 *
 * Inputs:
 *   session    (object) - Session from f5Login
 *   name       (string) - Node name
 *   partition  (string) - Partition (default: "Common")
 *
 * Output:
 *   result (object) - { success, statusCode }
 */
function f5DeleteNode(session, name, partition) {
    if (!name || name.trim() === "") {
        throw new Error("f5DeleteNode: name is required.");
    }
    partition = partition || "Common";

    System.log("[f5DeleteNode] Deleting node: " + name);

    var uri = f5BuildUri("/mgmt/tm/ltm/node", name, partition);
    var response = f5MakeRequest(session, "DELETE", uri, null);

    if (response.success) {
        System.log("[f5DeleteNode] Deleted successfully: " + name);
        return { success: true, statusCode: response.statusCode };
    } else {
        System.error("[f5DeleteNode] Delete failed for: " + name);
        return { success: false, statusCode: response.statusCode };
    }
}


/**
 * --- Action: f5ListNodes ---
 * Lists all Nodes on the F5 BIG-IP (optionally filtered by partition).
 *
 * Inputs:
 *   session    (object) - Session from f5Login
 *   partition  (string) - Partition filter (default: null = all partitions)
 *
 * Output:
 *   result (Array) - Array of node objects
 */
function f5ListNodes(session, partition) {
    System.log("[f5ListNodes] Fetching all nodes...");

    var endpoint = "/mgmt/tm/ltm/node";
    if (partition) {
        endpoint += "?$filter=partition%20eq%20" + partition;
    }

    var response = f5MakeRequest(session, "GET", endpoint, null);

    if (response.success && response.body && response.body.items) {
        var nodes = response.body.items;
        System.log("[f5ListNodes] Found " + nodes.length + " node(s).");
        for (var i = 0; i < nodes.length; i++) {
            System.log("  [" + (i + 1) + "] " + nodes[i].fullPath + " (" + nodes[i].address + ") - State: " + nodes[i].state);
        }
        return nodes;
    }

    System.warn("[f5ListNodes] No nodes found or request failed.");
    return [];
}


/**
 * --- Action: f5EnableDisableNode ---
 * Convenience action to enable or disable a node.
 *
 * F5 Node States:
 *   - "user-enabled"  → Node is available
 *   - "user-disabled" → Node is administratively disabled (graceful)
 *   - "user-down"     → Node is forced offline (immediate)
 *
 * Inputs:
 *   session   (object)  - Session from f5Login
 *   name      (string)  - Node name
 *   enabled   (boolean) - true = enable, false = disable (graceful)
 *   partition (string)  - Partition (default: "Common")
 *
 * Output:
 *   result (object) - { name, session, success }
 */
function f5EnableDisableNode(session, name, enabled, partition) {
    if (!name || name.trim() === "") {
        throw new Error("f5EnableDisableNode: name is required.");
    }

    var state = enabled ? "user-enabled" : "user-disabled";
    System.log("[f5EnableDisableNode] Setting node " + name + " to: " + state);

    return f5UpdateNode(session, name, { "session": state }, partition);
}
