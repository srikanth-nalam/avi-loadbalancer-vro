/**
 * AVI Health Monitor CRUD Actions
 * =================================
 * Create, Read, Update, Delete operations for AVI Health Monitors.
 *
 * Health Monitors validate that backend servers are healthy before
 * the load balancer sends traffic to them.
 *
 * @module com.vmware.avi.healthmonitor
 * @version 1.0.0
 * @compatible VCF 9 / vRO 8.x
 *
 * AVI API Endpoint: /api/healthmonitor
 * Supported Types: HTTP, HTTPS, TCP, UDP, PING, DNS, EXTERNAL
 */


/**
 * --- Action: createHealthMonitor ---
 * Creates a new Health Monitor on the AVI Controller.
 *
 * Inputs:
 *   restHost       (REST:RESTHost) - Authenticated REST host
 *   apiVersion     (string)        - AVI API version (e.g., "22.1.1")
 *   name           (string)        - Health monitor name (e.g., "HM-HTTP-App1")
 *   type           (string)        - Monitor type: HEALTH_MONITOR_HTTP, HEALTH_MONITOR_HTTPS,
 *                                     HEALTH_MONITOR_TCP, HEALTH_MONITOR_UDP,
 *                                     HEALTH_MONITOR_PING, HEALTH_MONITOR_DNS
 *   sendInterval   (number)        - Interval between checks in seconds (default: 10)
 *   receiveTimeout (number)        - Timeout for a single check in seconds (default: 4)
 *   failedChecks   (number)        - Consecutive failures to mark server down (default: 3)
 *   successChecks  (number)        - Consecutive successes to mark server up (default: 2)
 *   httpRequest    (string|null)   - HTTP request string for HTTP/HTTPS monitors
 *                                     (e.g., "GET / HTTP/1.0")
 *   httpResponseCode (Array|null)  - Expected HTTP response codes
 *                                     (e.g., ["HTTP_2XX", "HTTP_3XX"])
 *
 * Output:
 *   result (object) - { uuid: string, name: string, success: boolean, statusCode: number }
 */
function createHealthMonitor(restHost, apiVersion, name, type, sendInterval, receiveTimeout,
                              failedChecks, successChecks, httpRequest, httpResponseCode) {

    // Input validation
    if (!name || name.trim() === "") {
        throw new Error("createHealthMonitor: name is required.");
    }
    if (!type || type.trim() === "") {
        throw new Error("createHealthMonitor: type is required.");
    }

    // Apply defaults
    sendInterval = sendInterval || 10;
    receiveTimeout = receiveTimeout || 4;
    failedChecks = failedChecks || 3;
    successChecks = successChecks || 2;

    System.log("[createHealthMonitor] Creating health monitor: " + name + " (Type: " + type + ")");

    // Build payload
    var payload = {
        "name": name,
        "type": type,
        "send_interval": sendInterval,
        "receive_timeout": receiveTimeout,
        "failed_checks": failedChecks,
        "successful_checks": successChecks,
        "description": "Created by vRO Automation"
    };

    // Add HTTP-specific settings if applicable
    if (type === "HEALTH_MONITOR_HTTP" || type === "HEALTH_MONITOR_HTTPS") {
        var httpMonitor = {};

        // Default HTTP request: HEAD / HTTP/1.0
        httpMonitor.http_request = httpRequest || "GET / HTTP/1.0";

        // Default expected response codes
        if (httpResponseCode && httpResponseCode.length > 0) {
            httpMonitor.http_response_code = httpResponseCode;
        } else {
            httpMonitor.http_response_code = ["HTTP_2XX"];
        }

        if (type === "HEALTH_MONITOR_HTTP") {
            payload.http_monitor = httpMonitor;
        } else {
            payload.https_monitor = httpMonitor;
        }
    }

    System.log("[createHealthMonitor] Payload: " + JSON.stringify(payload));

    // Make API call
    var response = aviMakeRequest(restHost, "POST", "/api/healthmonitor", JSON.stringify(payload), apiVersion);

    if (response.success) {
        System.log("[createHealthMonitor] Created successfully. UUID: " + response.body.uuid);
        return {
            uuid: response.body.uuid,
            name: response.body.name,
            success: true,
            statusCode: response.statusCode
        };
    } else {
        System.error("[createHealthMonitor] Failed to create health monitor: " + name);
        return {
            uuid: null,
            name: name,
            success: false,
            statusCode: response.statusCode
        };
    }
}


/**
 * --- Action: getHealthMonitor ---
 * Reads a Health Monitor by name or UUID.
 *
 * Inputs:
 *   restHost    (REST:RESTHost) - Authenticated REST host
 *   apiVersion  (string)        - AVI API version
 *   nameOrUuid  (string)        - Health monitor name or UUID
 *
 * Output:
 *   result (object) - Full health monitor object from AVI, or null if not found
 */
function getHealthMonitor(restHost, apiVersion, nameOrUuid) {
    if (!nameOrUuid || nameOrUuid.trim() === "") {
        throw new Error("getHealthMonitor: nameOrUuid is required.");
    }

    System.log("[getHealthMonitor] Fetching health monitor: " + nameOrUuid);

    // Try by name first (search API)
    var endpoint = "/api/healthmonitor?name=" + encodeURIComponent(nameOrUuid);
    var response = aviMakeRequest(restHost, "GET", endpoint, null, apiVersion);

    if (response.success && response.body && response.body.count > 0) {
        var hm = response.body.results[0];
        System.log("[getHealthMonitor] Found: " + hm.name + " (UUID: " + hm.uuid + ")");
        System.log("[getHealthMonitor] Type: " + hm.type);
        System.log("[getHealthMonitor] Send Interval: " + hm.send_interval + "s");
        System.log("[getHealthMonitor] Receive Timeout: " + hm.receive_timeout + "s");
        return hm;
    }

    // Try by UUID if name search returned nothing
    endpoint = "/api/healthmonitor/" + nameOrUuid;
    response = aviMakeRequest(restHost, "GET", endpoint, null, apiVersion);

    if (response.success) {
        System.log("[getHealthMonitor] Found by UUID: " + response.body.name);
        return response.body;
    }

    System.warn("[getHealthMonitor] Health monitor not found: " + nameOrUuid);
    return null;
}


/**
 * --- Action: updateHealthMonitor ---
 * Updates an existing Health Monitor.
 *
 * Inputs:
 *   restHost       (REST:RESTHost) - Authenticated REST host
 *   apiVersion     (string)        - AVI API version
 *   uuid           (string)        - Health monitor UUID to update
 *   updateFields   (object)        - Object with fields to update, e.g.:
 *                                     { send_interval: 15, receive_timeout: 5 }
 *
 * Output:
 *   result (object) - { uuid: string, success: boolean, statusCode: number }
 */
function updateHealthMonitor(restHost, apiVersion, uuid, updateFields) {
    if (!uuid || uuid.trim() === "") {
        throw new Error("updateHealthMonitor: uuid is required.");
    }
    if (!updateFields) {
        throw new Error("updateHealthMonitor: updateFields is required.");
    }

    System.log("[updateHealthMonitor] Updating health monitor UUID: " + uuid);

    // Step 1: GET the current object (AVI requires full object for PUT)
    var endpoint = "/api/healthmonitor/" + uuid;
    var getResponse = aviMakeRequest(restHost, "GET", endpoint, null, apiVersion);

    if (!getResponse.success) {
        throw new Error("updateHealthMonitor: Could not fetch existing health monitor: " + uuid);
    }

    var currentObj = getResponse.body;

    // Step 2: Merge updates into current object
    for (var key in updateFields) {
        if (updateFields.hasOwnProperty(key)) {
            currentObj[key] = updateFields[key];
            System.log("[updateHealthMonitor] Setting " + key + " = " + JSON.stringify(updateFields[key]));
        }
    }

    // Step 3: PUT the updated object
    var putResponse = aviMakeRequest(restHost, "PUT", endpoint, JSON.stringify(currentObj), apiVersion);

    if (putResponse.success) {
        System.log("[updateHealthMonitor] Updated successfully. UUID: " + putResponse.body.uuid);
        return { uuid: putResponse.body.uuid, success: true, statusCode: putResponse.statusCode };
    } else {
        System.error("[updateHealthMonitor] Update failed for UUID: " + uuid);
        return { uuid: uuid, success: false, statusCode: putResponse.statusCode };
    }
}


/**
 * --- Action: deleteHealthMonitor ---
 * Deletes a Health Monitor by UUID.
 *
 * Inputs:
 *   restHost    (REST:RESTHost) - Authenticated REST host
 *   apiVersion  (string)        - AVI API version
 *   uuid        (string)        - Health monitor UUID to delete
 *
 * Output:
 *   result (object) - { success: boolean, statusCode: number }
 */
function deleteHealthMonitor(restHost, apiVersion, uuid) {
    if (!uuid || uuid.trim() === "") {
        throw new Error("deleteHealthMonitor: uuid is required.");
    }

    System.log("[deleteHealthMonitor] Deleting health monitor UUID: " + uuid);

    var endpoint = "/api/healthmonitor/" + uuid;
    var response = aviMakeRequest(restHost, "DELETE", endpoint, null, apiVersion);

    if (response.success) {
        System.log("[deleteHealthMonitor] Deleted successfully. UUID: " + uuid);
        return { success: true, statusCode: response.statusCode };
    } else {
        System.error("[deleteHealthMonitor] Delete failed for UUID: " + uuid);
        return { success: false, statusCode: response.statusCode };
    }
}


/**
 * --- Action: listHealthMonitors ---
 * Lists all Health Monitors on the AVI Controller.
 *
 * Inputs:
 *   restHost    (REST:RESTHost) - Authenticated REST host
 *   apiVersion  (string)        - AVI API version
 *
 * Output:
 *   result (Array) - Array of health monitor objects
 */
function listHealthMonitors(restHost, apiVersion) {
    System.log("[listHealthMonitors] Fetching all health monitors...");

    var response = aviMakeRequest(restHost, "GET", "/api/healthmonitor", null, apiVersion);

    if (response.success && response.body && response.body.results) {
        var monitors = response.body.results;
        System.log("[listHealthMonitors] Found " + monitors.length + " health monitor(s).");
        for (var i = 0; i < monitors.length; i++) {
            System.log("  [" + (i + 1) + "] " + monitors[i].name + " (" + monitors[i].type + ") - UUID: " + monitors[i].uuid);
        }
        return monitors;
    }

    System.warn("[listHealthMonitors] No health monitors found or request failed.");
    return [];
}
