/**
 * AVI Pool CRUD Actions
 * =======================
 * Create, Read, Update, Delete operations for AVI Server Pools.
 *
 * A Pool maintains a list of backend servers and performs health monitoring,
 * load balancing, persistence, and server-side interactions.
 *
 * @module com.vmware.avi.pool
 * @version 1.0.0
 * @compatible VCF 9 / vRO 8.x
 *
 * AVI API Endpoint: /api/pool
 * LB Algorithms: LB_ALGORITHM_LEAST_CONNECTIONS, LB_ALGORITHM_ROUND_ROBIN,
 *                LB_ALGORITHM_FASTEST_RESPONSE, LB_ALGORITHM_CONSISTENT_HASH
 */


/**
 * --- Action: createPool ---
 * Creates a new Server Pool on the AVI Controller.
 *
 * Inputs:
 *   restHost          (REST:RESTHost) - Authenticated REST host
 *   apiVersion        (string)        - AVI API version
 *   name              (string)        - Pool name (e.g., "Pool-WebApp-Prod")
 *   servers           (Array)         - Array of server objects:
 *                                        [{ ip: "10.0.1.10", port: 8080 }, ...]
 *   defaultServerPort (number)        - Default port for all servers (default: 80)
 *   lbAlgorithm       (string)        - Load balancing algorithm (default: LB_ALGORITHM_ROUND_ROBIN)
 *   healthMonitorRef  (string|null)   - Health monitor URL ref (e.g., "/api/healthmonitor/<uuid>")
 *   cloudRef          (string|null)   - Cloud URL ref (e.g., "/api/cloud/<uuid>")
 *
 * Output:
 *   result (object) - { uuid: string, name: string, success: boolean, statusCode: number }
 */
function createPool(restHost, apiVersion, name, servers, defaultServerPort, lbAlgorithm, healthMonitorRef, cloudRef) {

    // Input validation
    if (!name || name.trim() === "") {
        throw new Error("createPool: name is required.");
    }
    if (!servers || servers.length === 0) {
        throw new Error("createPool: At least one server is required.");
    }

    // Defaults
    defaultServerPort = defaultServerPort || 80;
    lbAlgorithm = lbAlgorithm || "LB_ALGORITHM_ROUND_ROBIN";

    System.log("[createPool] Creating pool: " + name + " with " + servers.length + " server(s)");

    // Build servers array in AVI format
    var aviServers = [];
    for (var i = 0; i < servers.length; i++) {
        var srv = servers[i];
        if (!srv.ip || srv.ip.trim() === "") {
            System.warn("[createPool] Skipping server at index " + i + " — no IP address.");
            continue;
        }

        var aviServer = {
            "ip": {
                "addr": srv.ip,
                "type": "V4"    // IPv4. Use "V6" for IPv6.
            },
            "port": srv.port || defaultServerPort,
            "enabled": true
        };
        aviServers.push(aviServer);
        System.log("[createPool] Server " + (i + 1) + ": " + srv.ip + ":" + (srv.port || defaultServerPort));
    }

    if (aviServers.length === 0) {
        throw new Error("createPool: No valid servers provided after validation.");
    }

    // Build pool payload
    var payload = {
        "name": name,
        "description": "Created by vRO Automation",
        "lb_algorithm": lbAlgorithm,
        "default_server_port": defaultServerPort,
        "servers": aviServers
    };

    // Attach health monitor if provided
    if (healthMonitorRef && healthMonitorRef.trim() !== "") {
        payload.health_monitor_refs = [healthMonitorRef];
        System.log("[createPool] Health monitor attached: " + healthMonitorRef);
    }

    // Attach cloud reference if provided
    if (cloudRef && cloudRef.trim() !== "") {
        payload.cloud_ref = cloudRef;
        System.log("[createPool] Cloud ref: " + cloudRef);
    }

    System.log("[createPool] Payload: " + JSON.stringify(payload));

    // Make API call
    var response = aviMakeRequest(restHost, "POST", "/api/pool", JSON.stringify(payload), apiVersion);

    if (response.success) {
        System.log("[createPool] Created successfully. UUID: " + response.body.uuid);
        return {
            uuid: response.body.uuid,
            name: response.body.name,
            url: response.body.url,
            success: true,
            statusCode: response.statusCode
        };
    } else {
        System.error("[createPool] Failed to create pool: " + name);
        return { uuid: null, name: name, success: false, statusCode: response.statusCode };
    }
}


/**
 * --- Action: getPool ---
 * Reads a Pool by name or UUID.
 *
 * Inputs:
 *   restHost    (REST:RESTHost) - Authenticated REST host
 *   apiVersion  (string)        - AVI API version
 *   nameOrUuid  (string)        - Pool name or UUID
 *
 * Output:
 *   result (object) - Full pool object from AVI, or null if not found
 */
function getPool(restHost, apiVersion, nameOrUuid) {
    if (!nameOrUuid || nameOrUuid.trim() === "") {
        throw new Error("getPool: nameOrUuid is required.");
    }

    System.log("[getPool] Fetching pool: " + nameOrUuid);

    // Try by name first
    var endpoint = "/api/pool?name=" + encodeURIComponent(nameOrUuid);
    var response = aviMakeRequest(restHost, "GET", endpoint, null, apiVersion);

    if (response.success && response.body && response.body.count > 0) {
        var pool = response.body.results[0];
        System.log("[getPool] Found: " + pool.name + " (UUID: " + pool.uuid + ")");
        System.log("[getPool] Algorithm: " + pool.lb_algorithm);
        System.log("[getPool] Servers: " + (pool.servers ? pool.servers.length : 0));
        if (pool.servers) {
            for (var i = 0; i < pool.servers.length; i++) {
                System.log("  Server " + (i + 1) + ": " + pool.servers[i].ip.addr + ":" + pool.servers[i].port);
            }
        }
        return pool;
    }

    // Try by UUID
    endpoint = "/api/pool/" + nameOrUuid;
    response = aviMakeRequest(restHost, "GET", endpoint, null, apiVersion);

    if (response.success) {
        System.log("[getPool] Found by UUID: " + response.body.name);
        return response.body;
    }

    System.warn("[getPool] Pool not found: " + nameOrUuid);
    return null;
}


/**
 * --- Action: updatePool ---
 * Updates an existing Pool (e.g., add/remove servers, change LB algorithm).
 *
 * Inputs:
 *   restHost      (REST:RESTHost) - Authenticated REST host
 *   apiVersion    (string)        - AVI API version
 *   uuid          (string)        - Pool UUID to update
 *   updateFields  (object)        - Fields to update. Examples:
 *     { lb_algorithm: "LB_ALGORITHM_LEAST_CONNECTIONS" }
 *     { servers: [{ ip: { addr: "10.0.1.20", type: "V4" }, port: 8080 }] }
 *
 * Output:
 *   result (object) - { uuid: string, success: boolean, statusCode: number }
 */
function updatePool(restHost, apiVersion, uuid, updateFields) {
    if (!uuid || uuid.trim() === "") {
        throw new Error("updatePool: uuid is required.");
    }
    if (!updateFields) {
        throw new Error("updatePool: updateFields is required.");
    }

    System.log("[updatePool] Updating pool UUID: " + uuid);

    // Step 1: GET the current pool object (AVI requires full object for PUT)
    var endpoint = "/api/pool/" + uuid;
    var getResponse = aviMakeRequest(restHost, "GET", endpoint, null, apiVersion);

    if (!getResponse.success) {
        throw new Error("updatePool: Could not fetch existing pool: " + uuid);
    }

    var currentPool = getResponse.body;

    // Step 2: Merge updates
    for (var key in updateFields) {
        if (updateFields.hasOwnProperty(key)) {
            currentPool[key] = updateFields[key];
            System.log("[updatePool] Setting " + key + " = " + JSON.stringify(updateFields[key]));
        }
    }

    // Step 3: PUT the updated pool
    var putResponse = aviMakeRequest(restHost, "PUT", endpoint, JSON.stringify(currentPool), apiVersion);

    if (putResponse.success) {
        System.log("[updatePool] Updated successfully. UUID: " + putResponse.body.uuid);
        return { uuid: putResponse.body.uuid, success: true, statusCode: putResponse.statusCode };
    } else {
        System.error("[updatePool] Update failed for UUID: " + uuid);
        return { uuid: uuid, success: false, statusCode: putResponse.statusCode };
    }
}


/**
 * --- Action: addServerToPool ---
 * Adds a new server to an existing pool without removing existing servers.
 *
 * Inputs:
 *   restHost    (REST:RESTHost) - Authenticated REST host
 *   apiVersion  (string)        - AVI API version
 *   poolUuid    (string)        - Pool UUID
 *   serverIp    (string)        - New server IP address
 *   serverPort  (number)        - New server port
 *
 * Output:
 *   result (object) - { success: boolean, totalServers: number }
 */
function addServerToPool(restHost, apiVersion, poolUuid, serverIp, serverPort) {
    if (!poolUuid) throw new Error("addServerToPool: poolUuid is required.");
    if (!serverIp) throw new Error("addServerToPool: serverIp is required.");

    serverPort = serverPort || 80;

    System.log("[addServerToPool] Adding " + serverIp + ":" + serverPort + " to pool " + poolUuid);

    // Get current pool
    var endpoint = "/api/pool/" + poolUuid;
    var getResponse = aviMakeRequest(restHost, "GET", endpoint, null, apiVersion);

    if (!getResponse.success) {
        throw new Error("addServerToPool: Pool not found: " + poolUuid);
    }

    var pool = getResponse.body;
    if (!pool.servers) {
        pool.servers = [];
    }

    // Check for duplicate
    for (var i = 0; i < pool.servers.length; i++) {
        if (pool.servers[i].ip.addr === serverIp && pool.servers[i].port === serverPort) {
            System.warn("[addServerToPool] Server " + serverIp + ":" + serverPort + " already exists in pool.");
            return { success: true, totalServers: pool.servers.length };
        }
    }

    // Add new server
    pool.servers.push({
        "ip": { "addr": serverIp, "type": "V4" },
        "port": serverPort,
        "enabled": true
    });

    // PUT updated pool
    var putResponse = aviMakeRequest(restHost, "PUT", endpoint, JSON.stringify(pool), apiVersion);

    if (putResponse.success) {
        System.log("[addServerToPool] Server added. Total servers: " + putResponse.body.servers.length);
        return { success: true, totalServers: putResponse.body.servers.length };
    } else {
        return { success: false, totalServers: pool.servers.length - 1 };
    }
}


/**
 * --- Action: removeServerFromPool ---
 * Removes a server from an existing pool.
 *
 * Inputs:
 *   restHost    (REST:RESTHost) - Authenticated REST host
 *   apiVersion  (string)        - AVI API version
 *   poolUuid    (string)        - Pool UUID
 *   serverIp    (string)        - Server IP to remove
 *
 * Output:
 *   result (object) - { success: boolean, totalServers: number }
 */
function removeServerFromPool(restHost, apiVersion, poolUuid, serverIp) {
    if (!poolUuid) throw new Error("removeServerFromPool: poolUuid is required.");
    if (!serverIp) throw new Error("removeServerFromPool: serverIp is required.");

    System.log("[removeServerFromPool] Removing " + serverIp + " from pool " + poolUuid);

    var endpoint = "/api/pool/" + poolUuid;
    var getResponse = aviMakeRequest(restHost, "GET", endpoint, null, apiVersion);

    if (!getResponse.success) {
        throw new Error("removeServerFromPool: Pool not found: " + poolUuid);
    }

    var pool = getResponse.body;
    var originalCount = pool.servers ? pool.servers.length : 0;

    // Filter out the target server
    var filtered = [];
    for (var i = 0; i < (pool.servers || []).length; i++) {
        if (pool.servers[i].ip.addr !== serverIp) {
            filtered.push(pool.servers[i]);
        }
    }

    if (filtered.length === originalCount) {
        System.warn("[removeServerFromPool] Server " + serverIp + " not found in pool.");
        return { success: true, totalServers: originalCount };
    }

    pool.servers = filtered;

    var putResponse = aviMakeRequest(restHost, "PUT", endpoint, JSON.stringify(pool), apiVersion);

    if (putResponse.success) {
        System.log("[removeServerFromPool] Server removed. Remaining: " + filtered.length);
        return { success: true, totalServers: filtered.length };
    } else {
        return { success: false, totalServers: originalCount };
    }
}


/**
 * --- Action: deletePool ---
 * Deletes a Pool by UUID.
 *
 * Inputs:
 *   restHost    (REST:RESTHost) - Authenticated REST host
 *   apiVersion  (string)        - AVI API version
 *   uuid        (string)        - Pool UUID to delete
 *
 * Output:
 *   result (object) - { success: boolean, statusCode: number }
 */
function deletePool(restHost, apiVersion, uuid) {
    if (!uuid || uuid.trim() === "") {
        throw new Error("deletePool: uuid is required.");
    }

    System.log("[deletePool] Deleting pool UUID: " + uuid);

    var response = aviMakeRequest(restHost, "DELETE", "/api/pool/" + uuid, null, apiVersion);

    if (response.success) {
        System.log("[deletePool] Deleted successfully. UUID: " + uuid);
        return { success: true, statusCode: response.statusCode };
    } else {
        System.error("[deletePool] Delete failed for UUID: " + uuid);
        return { success: false, statusCode: response.statusCode };
    }
}


/**
 * --- Action: listPools ---
 * Lists all Pools on the AVI Controller.
 *
 * Inputs:
 *   restHost    (REST:RESTHost) - Authenticated REST host
 *   apiVersion  (string)        - AVI API version
 *
 * Output:
 *   result (Array) - Array of pool objects
 */
function listPools(restHost, apiVersion) {
    System.log("[listPools] Fetching all pools...");

    var response = aviMakeRequest(restHost, "GET", "/api/pool", null, apiVersion);

    if (response.success && response.body && response.body.results) {
        var pools = response.body.results;
        System.log("[listPools] Found " + pools.length + " pool(s).");
        for (var i = 0; i < pools.length; i++) {
            var serverCount = pools[i].servers ? pools[i].servers.length : 0;
            System.log("  [" + (i + 1) + "] " + pools[i].name + " - Servers: " + serverCount + " - UUID: " + pools[i].uuid);
        }
        return pools;
    }

    System.warn("[listPools] No pools found or request failed.");
    return [];
}
