/**
 * F5 BIG-IP Virtual Server CRUD Actions
 * ========================================
 * Create, Read, Update, Delete operations for F5 LTM Virtual Servers.
 *
 * A Virtual Server is the front-end listener on the F5. It binds a
 * VIP address + port to a Pool of backend servers, with optional
 * profiles (HTTP, TCP, SSL, etc.) and iRules.
 *
 * F5 Virtual Server Types:
 *   - Standard    → Full proxy (most common for HTTP/HTTPS)
 *   - Forwarding  → IP forwarding
 *   - Performance  → Layer 4 optimization
 *   - Reject      → Reset/reject connections
 *
 * @module com.f5.bigip.virtual
 * @version 1.0.0
 * @compatible VCF 9 / vRO 8.x
 *
 * API Endpoint: /mgmt/tm/ltm/virtual
 *
 * Dependencies:
 *   - f5Auth.js (f5MakeRequest, f5BuildUri)
 *   - f5Pool.js (pool must exist before VS references it)
 */


/**
 * --- Action: f5CreateVirtualServer ---
 * Creates a new Virtual Server on the F5 BIG-IP.
 *
 * Inputs:
 *   session             (object) - Session from f5Login
 *   name                (string) - VS name (e.g., "vs-webapp-prod")
 *   destination         (string) - VIP address and port (e.g., "10.0.1.100:80")
 *   mask                (string) - Destination mask (default: "255.255.255.255")
 *   poolName            (string) - Pool name to attach (e.g., "pool-webapp-prod")
 *   profiles            (Array)  - Profile names to attach. Examples:
 *                                   [{ name: "http" }, { name: "tcp" }]
 *                                   If null, uses system defaults.
 *   snatType            (string) - SNAT: "automap", "none", or pool name (default: "automap")
 *   persistenceProfile  (string) - Persistence: "source_addr", "cookie", "ssl", "none"
 *   iRules              (Array)  - iRule paths: ["/Common/my-irule"]. null = none.
 *   partition           (string) - Partition (default: "Common")
 *   ipProtocol          (string) - Protocol: "tcp", "udp", "any" (default: "tcp")
 *
 * Output:
 *   result (object) - { name, fullPath, destination, success, statusCode }
 */
function f5CreateVirtualServer(session, name, destination, mask, poolName, profiles,
                                snatType, persistenceProfile, iRules, partition, ipProtocol) {

    // Input validation
    if (!name || name.trim() === "") {
        throw new Error("f5CreateVirtualServer: name is required.");
    }
    if (!destination || destination.trim() === "") {
        throw new Error("f5CreateVirtualServer: destination (VIP:port) is required.");
    }

    partition = partition || "Common";
    mask = mask || "255.255.255.255";
    snatType = snatType || "automap";
    ipProtocol = ipProtocol || "tcp";

    // Format destination: must be /partition/ip:port or /partition/ip%route_domain:port
    var formattedDest = destination;
    if (formattedDest.indexOf("/") !== 0) {
        formattedDest = "/" + partition + "/" + formattedDest;
    }

    System.log("[f5CreateVirtualServer] Creating Virtual Server: " + name);
    System.log("[f5CreateVirtualServer] Destination: " + formattedDest);

    // Build payload
    var payload = {
        "name": name,
        "partition": partition,
        "destination": formattedDest,
        "mask": mask,
        "ipProtocol": ipProtocol,
        "description": "Created by vRO Automation",
        "enabled": true
    };

    // Attach pool
    if (poolName && poolName.trim() !== "") {
        if (poolName.indexOf("/") !== 0) {
            poolName = "/" + partition + "/" + poolName;
        }
        payload.pool = poolName;
        System.log("[f5CreateVirtualServer] Pool: " + poolName);
    }

    // Source NAT
    if (snatType.toLowerCase() === "automap") {
        payload.sourceAddressTranslation = { "type": "automap" };
    } else if (snatType.toLowerCase() !== "none") {
        payload.sourceAddressTranslation = { "type": "snat", "pool": snatType };
    }

    // Profiles
    if (profiles && profiles.length > 0) {
        payload.profiles = profiles;
        for (var i = 0; i < profiles.length; i++) {
            System.log("[f5CreateVirtualServer] Profile: " + (profiles[i].name || profiles[i]));
        }
    }

    // Persistence
    if (persistenceProfile && persistenceProfile.toLowerCase() !== "none") {
        payload.persist = [{ "name": persistenceProfile }];
        System.log("[f5CreateVirtualServer] Persistence: " + persistenceProfile);
    }

    // iRules
    if (iRules && iRules.length > 0) {
        payload.rules = iRules;
        for (var j = 0; j < iRules.length; j++) {
            System.log("[f5CreateVirtualServer] iRule: " + iRules[j]);
        }
    }

    System.log("[f5CreateVirtualServer] Payload: " + JSON.stringify(payload));

    var response = f5MakeRequest(session, "POST", "/mgmt/tm/ltm/virtual", JSON.stringify(payload));

    if (response.success) {
        System.log("[f5CreateVirtualServer] Created successfully: " + response.body.fullPath);
        return {
            name: response.body.name,
            fullPath: response.body.fullPath,
            destination: response.body.destination,
            success: true,
            statusCode: response.statusCode
        };
    } else {
        if (response.statusCode === 409) {
            System.warn("[f5CreateVirtualServer] VS already exists: " + name);
            return { name: name, fullPath: "/" + partition + "/" + name, destination: formattedDest, success: true, statusCode: 409 };
        }
        System.error("[f5CreateVirtualServer] Failed to create VS: " + name);
        return { name: name, fullPath: null, destination: formattedDest, success: false, statusCode: response.statusCode };
    }
}


/**
 * --- Action: f5GetVirtualServer ---
 * Reads a Virtual Server by name.
 *
 * Inputs:
 *   session    (object) - Session from f5Login
 *   name       (string) - VS name
 *   partition  (string) - Partition (default: "Common")
 *
 * Output:
 *   result (object) - Full VS object from F5, or null if not found
 */
function f5GetVirtualServer(session, name, partition) {
    if (!name || name.trim() === "") {
        throw new Error("f5GetVirtualServer: name is required.");
    }
    partition = partition || "Common";

    System.log("[f5GetVirtualServer] Fetching Virtual Server: " + name);

    var uri = f5BuildUri("/mgmt/tm/ltm/virtual", name, partition);
    var response = f5MakeRequest(session, "GET", uri + "?expandSubcollections=true", null);

    if (response.success) {
        var vs = response.body;
        System.log("[f5GetVirtualServer] Found: " + vs.fullPath);
        System.log("[f5GetVirtualServer] Destination: " + vs.destination);
        System.log("[f5GetVirtualServer] Pool: " + (vs.pool || "none"));
        System.log("[f5GetVirtualServer] Enabled: " + vs.enabled);
        System.log("[f5GetVirtualServer] Protocol: " + vs.ipProtocol);

        // Log profiles
        if (vs.profilesReference && vs.profilesReference.items) {
            for (var i = 0; i < vs.profilesReference.items.length; i++) {
                System.log("[f5GetVirtualServer] Profile: " + vs.profilesReference.items[i].fullPath);
            }
        }

        return vs;
    }

    System.warn("[f5GetVirtualServer] VS not found: " + name);
    return null;
}


/**
 * --- Action: f5UpdateVirtualServer ---
 * Updates an existing Virtual Server.
 *
 * Common use cases:
 *   - Switch pool: { "pool": "/Common/new-pool" }
 *   - Disable VS: { "disabled": true, "enabled": false }
 *   - Change SNAT: { "sourceAddressTranslation": { "type": "automap" } }
 *   - Add persistence: { "persist": [{ "name": "source_addr" }] }
 *
 * Inputs:
 *   session      (object) - Session from f5Login
 *   name         (string) - VS name
 *   updateFields (object) - Fields to update
 *   partition    (string) - Partition (default: "Common")
 *
 * Output:
 *   result (object) - { name, success, statusCode }
 */
function f5UpdateVirtualServer(session, name, updateFields, partition) {
    if (!name || name.trim() === "") {
        throw new Error("f5UpdateVirtualServer: name is required.");
    }
    if (!updateFields) {
        throw new Error("f5UpdateVirtualServer: updateFields is required.");
    }
    partition = partition || "Common";

    System.log("[f5UpdateVirtualServer] Updating Virtual Server: " + name);

    var uri = f5BuildUri("/mgmt/tm/ltm/virtual", name, partition);
    var response = f5MakeRequest(session, "PATCH", uri, JSON.stringify(updateFields));

    if (response.success) {
        System.log("[f5UpdateVirtualServer] Updated: " + name);
        return { name: response.body.name, success: true, statusCode: response.statusCode };
    } else {
        System.error("[f5UpdateVirtualServer] Update failed for: " + name);
        return { name: name, success: false, statusCode: response.statusCode };
    }
}


/**
 * --- Action: f5EnableDisableVirtualServer ---
 * Convenience action to enable or disable a Virtual Server.
 *
 * Inputs:
 *   session    (object)  - Session from f5Login
 *   name       (string)  - VS name
 *   enabled    (boolean) - true = enable, false = disable
 *   partition  (string)  - Partition (default: "Common")
 *
 * Output:
 *   result (object) - { name, enabled, success }
 */
function f5EnableDisableVirtualServer(session, name, enabled, partition) {
    if (!name || name.trim() === "") {
        throw new Error("f5EnableDisableVirtualServer: name is required.");
    }

    var action = enabled ? "Enabling" : "Disabling";
    System.log("[f5EnableDisableVirtualServer] " + action + " VS: " + name);

    var fields = enabled
        ? { "enabled": true, "disabled": false }
        : { "disabled": true, "enabled": false };

    var result = f5UpdateVirtualServer(session, name, fields, partition);

    return {
        name: name,
        enabled: enabled,
        success: result.success
    };
}


/**
 * --- Action: f5DeleteVirtualServer ---
 * Deletes a Virtual Server.
 *
 * Inputs:
 *   session    (object) - Session from f5Login
 *   name       (string) - VS name
 *   partition  (string) - Partition (default: "Common")
 *
 * Output:
 *   result (object) - { success, statusCode }
 */
function f5DeleteVirtualServer(session, name, partition) {
    if (!name || name.trim() === "") {
        throw new Error("f5DeleteVirtualServer: name is required.");
    }
    partition = partition || "Common";

    System.log("[f5DeleteVirtualServer] Deleting Virtual Server: " + name);

    var uri = f5BuildUri("/mgmt/tm/ltm/virtual", name, partition);
    var response = f5MakeRequest(session, "DELETE", uri, null);

    if (response.success) {
        System.log("[f5DeleteVirtualServer] Deleted: " + name);
        return { success: true, statusCode: response.statusCode };
    } else {
        System.error("[f5DeleteVirtualServer] Delete failed for: " + name);
        return { success: false, statusCode: response.statusCode };
    }
}


/**
 * --- Action: f5ListVirtualServers ---
 * Lists all Virtual Servers on the F5 BIG-IP.
 *
 * Inputs:
 *   session    (object) - Session from f5Login
 *   partition  (string) - Partition filter (null = all)
 *
 * Output:
 *   result (Array) - Array of VS objects
 */
function f5ListVirtualServers(session, partition) {
    System.log("[f5ListVirtualServers] Fetching all Virtual Servers...");

    var endpoint = "/mgmt/tm/ltm/virtual";
    if (partition) {
        endpoint += "?$filter=partition%20eq%20" + partition;
    }

    var response = f5MakeRequest(session, "GET", endpoint, null);

    if (response.success && response.body && response.body.items) {
        var vsList = response.body.items;
        System.log("[f5ListVirtualServers] Found " + vsList.length + " Virtual Server(s).");
        for (var i = 0; i < vsList.length; i++) {
            var enabled = vsList[i].enabled ? "Enabled" : "Disabled";
            System.log("  [" + (i + 1) + "] " + vsList[i].fullPath + " → " + vsList[i].destination +
                       " (" + enabled + ", Pool: " + (vsList[i].pool || "none") + ")");
        }
        return vsList;
    }

    System.warn("[f5ListVirtualServers] No Virtual Servers found.");
    return [];
}


/**
 * --- Action: f5GetVirtualServerStats ---
 * Retrieves runtime statistics for a Virtual Server.
 * Useful for verifying VS is active and receiving traffic.
 *
 * Inputs:
 *   session    (object) - Session from f5Login
 *   name       (string) - VS name
 *   partition  (string) - Partition (default: "Common")
 *
 * Output:
 *   result (object) - Stats object with counters, or null if not found
 */
function f5GetVirtualServerStats(session, name, partition) {
    if (!name || name.trim() === "") {
        throw new Error("f5GetVirtualServerStats: name is required.");
    }
    partition = partition || "Common";

    System.log("[f5GetVirtualServerStats] Fetching stats for VS: " + name);

    var uri = f5BuildUri("/mgmt/tm/ltm/virtual", name, partition) + "/stats";
    var response = f5MakeRequest(session, "GET", uri, null);

    if (response.success) {
        System.log("[f5GetVirtualServerStats] Stats retrieved for: " + name);
        return response.body;
    }

    System.warn("[f5GetVirtualServerStats] Could not fetch stats for: " + name);
    return null;
}
