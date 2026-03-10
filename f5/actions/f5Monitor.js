/**
 * F5 BIG-IP Health Monitor CRUD Actions
 * ========================================
 * Create, Read, Update, Delete operations for F5 LTM Health Monitors.
 *
 * F5 monitors check backend server health. Unlike AVI (single endpoint),
 * F5 uses separate sub-endpoints per monitor type:
 *   - /mgmt/tm/ltm/monitor/http
 *   - /mgmt/tm/ltm/monitor/https
 *   - /mgmt/tm/ltm/monitor/tcp
 *   - /mgmt/tm/ltm/monitor/gateway-icmp
 *   - /mgmt/tm/ltm/monitor/udp
 *
 * @module com.f5.bigip.monitor
 * @version 1.0.0
 * @compatible VCF 9 / vRO 8.x
 *
 * Dependencies:
 *   - f5Auth.js (f5MakeRequest, f5BuildUri)
 */


/**
 * Map of monitor type names to API paths.
 * This abstraction hides F5's per-type endpoint structure.
 */
var F5_MONITOR_TYPES = {
    "http":          "/mgmt/tm/ltm/monitor/http",
    "https":         "/mgmt/tm/ltm/monitor/https",
    "tcp":           "/mgmt/tm/ltm/monitor/tcp",
    "gateway-icmp":  "/mgmt/tm/ltm/monitor/gateway-icmp",
    "icmp":          "/mgmt/tm/ltm/monitor/gateway-icmp",
    "udp":           "/mgmt/tm/ltm/monitor/udp",
    "tcp-half-open": "/mgmt/tm/ltm/monitor/tcp-half-open"
};


/**
 * --- Action: f5CreateMonitor ---
 * Creates a new Health Monitor on the F5 BIG-IP.
 *
 * Inputs:
 *   session       (object) - Session from f5Login
 *   name          (string) - Monitor name (e.g., "mon-http-app1")
 *   type          (string) - Monitor type: "http", "https", "tcp", "gateway-icmp", "udp"
 *   interval      (number) - Check interval in seconds (default: 5)
 *   timeout       (number) - Timeout in seconds (default: 16, must be 3x+1 of interval)
 *   sendString    (string) - HTTP send string (for HTTP/HTTPS monitors, e.g., "GET / HTTP/1.1\r\nHost: app.example.com\r\n\r\n")
 *   receiveString (string) - Expected response string (e.g., "200 OK")
 *   partition     (string) - Partition (default: "Common")
 *
 * Output:
 *   result (object) - { name, fullPath, type, success, statusCode }
 */
function f5CreateMonitor(session, name, type, interval, timeout, sendString, receiveString, partition) {

    // Input validation
    if (!name || name.trim() === "") {
        throw new Error("f5CreateMonitor: name is required.");
    }
    if (!type || type.trim() === "") {
        throw new Error("f5CreateMonitor: type is required.");
    }

    type = type.toLowerCase();
    var basePath = F5_MONITOR_TYPES[type];
    if (!basePath) {
        throw new Error("f5CreateMonitor: Unsupported monitor type: " + type +
                        ". Supported: " + Object.keys(F5_MONITOR_TYPES).join(", "));
    }

    partition = partition || "Common";
    interval = interval || 5;
    timeout = timeout || (interval * 3 + 1); // F5 best practice: timeout = 3*interval + 1

    System.log("[f5CreateMonitor] Creating " + type + " monitor: " + name + " (interval: " + interval + "s, timeout: " + timeout + "s)");

    // Build payload
    var payload = {
        "name": name,
        "partition": partition,
        "interval": interval,
        "timeout": timeout,
        "description": "Created by vRO Automation"
    };

    // HTTP/HTTPS-specific settings
    if (type === "http" || type === "https") {
        if (sendString && sendString.trim() !== "") {
            payload.send = sendString;
        } else {
            payload.send = "GET / HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n";
        }
        if (receiveString && receiveString.trim() !== "") {
            payload.recv = receiveString;
        }
    }

    // TCP-specific: send/recv for TCP monitors
    if (type === "tcp") {
        if (sendString && sendString.trim() !== "") {
            payload.send = sendString;
        }
        if (receiveString && receiveString.trim() !== "") {
            payload.recv = receiveString;
        }
    }

    System.log("[f5CreateMonitor] Payload: " + JSON.stringify(payload));

    var response = f5MakeRequest(session, "POST", basePath, JSON.stringify(payload));

    if (response.success) {
        System.log("[f5CreateMonitor] Created successfully: " + response.body.fullPath);
        return {
            name: response.body.name,
            fullPath: response.body.fullPath,
            type: type,
            success: true,
            statusCode: response.statusCode
        };
    } else {
        if (response.statusCode === 409) {
            System.warn("[f5CreateMonitor] Monitor already exists: " + name);
            return {
                name: name,
                fullPath: "/" + partition + "/" + name,
                type: type,
                success: true,
                statusCode: response.statusCode
            };
        }
        System.error("[f5CreateMonitor] Failed to create monitor: " + name);
        return { name: name, fullPath: null, type: type, success: false, statusCode: response.statusCode };
    }
}


/**
 * --- Action: f5GetMonitor ---
 * Reads a Health Monitor by name and type.
 *
 * Inputs:
 *   session    (object) - Session from f5Login
 *   name       (string) - Monitor name
 *   type       (string) - Monitor type: "http", "https", "tcp", etc.
 *   partition  (string) - Partition (default: "Common")
 *
 * Output:
 *   result (object) - Full monitor object, or null if not found
 */
function f5GetMonitor(session, name, type, partition) {
    if (!name || name.trim() === "") {
        throw new Error("f5GetMonitor: name is required.");
    }
    if (!type || type.trim() === "") {
        throw new Error("f5GetMonitor: type is required.");
    }

    type = type.toLowerCase();
    partition = partition || "Common";

    var basePath = F5_MONITOR_TYPES[type];
    if (!basePath) {
        throw new Error("f5GetMonitor: Unsupported monitor type: " + type);
    }

    System.log("[f5GetMonitor] Fetching " + type + " monitor: " + name);

    var uri = f5BuildUri(basePath, name, partition);
    var response = f5MakeRequest(session, "GET", uri, null);

    if (response.success) {
        System.log("[f5GetMonitor] Found: " + response.body.fullPath);
        System.log("[f5GetMonitor] Interval: " + response.body.interval + "s, Timeout: " + response.body.timeout + "s");
        return response.body;
    }

    System.warn("[f5GetMonitor] Monitor not found: " + name + " (type: " + type + ")");
    return null;
}


/**
 * --- Action: f5UpdateMonitor ---
 * Updates an existing Health Monitor.
 *
 * Inputs:
 *   session      (object) - Session from f5Login
 *   name         (string) - Monitor name
 *   type         (string) - Monitor type
 *   updateFields (object) - Fields to update. Examples:
 *     { "interval": 10, "timeout": 31 }
 *     { "send": "GET /health HTTP/1.1\\r\\n\\r\\n", "recv": "OK" }
 *   partition    (string) - Partition (default: "Common")
 *
 * Output:
 *   result (object) - { name, success, statusCode }
 */
function f5UpdateMonitor(session, name, type, updateFields, partition) {
    if (!name || name.trim() === "") {
        throw new Error("f5UpdateMonitor: name is required.");
    }
    if (!type || type.trim() === "") {
        throw new Error("f5UpdateMonitor: type is required.");
    }
    if (!updateFields) {
        throw new Error("f5UpdateMonitor: updateFields is required.");
    }

    type = type.toLowerCase();
    partition = partition || "Common";

    var basePath = F5_MONITOR_TYPES[type];
    if (!basePath) {
        throw new Error("f5UpdateMonitor: Unsupported monitor type: " + type);
    }

    System.log("[f5UpdateMonitor] Updating " + type + " monitor: " + name);

    var uri = f5BuildUri(basePath, name, partition);
    var response = f5MakeRequest(session, "PATCH", uri, JSON.stringify(updateFields));

    if (response.success) {
        System.log("[f5UpdateMonitor] Updated successfully: " + name);
        return { name: response.body.name, success: true, statusCode: response.statusCode };
    } else {
        System.error("[f5UpdateMonitor] Update failed for: " + name);
        return { name: name, success: false, statusCode: response.statusCode };
    }
}


/**
 * --- Action: f5DeleteMonitor ---
 * Deletes a Health Monitor. Must not be referenced by any pool.
 *
 * Inputs:
 *   session    (object) - Session from f5Login
 *   name       (string) - Monitor name
 *   type       (string) - Monitor type
 *   partition  (string) - Partition (default: "Common")
 *
 * Output:
 *   result (object) - { success, statusCode }
 */
function f5DeleteMonitor(session, name, type, partition) {
    if (!name || name.trim() === "") {
        throw new Error("f5DeleteMonitor: name is required.");
    }
    if (!type || type.trim() === "") {
        throw new Error("f5DeleteMonitor: type is required.");
    }

    type = type.toLowerCase();
    partition = partition || "Common";

    var basePath = F5_MONITOR_TYPES[type];
    if (!basePath) {
        throw new Error("f5DeleteMonitor: Unsupported monitor type: " + type);
    }

    System.log("[f5DeleteMonitor] Deleting " + type + " monitor: " + name);

    var uri = f5BuildUri(basePath, name, partition);
    var response = f5MakeRequest(session, "DELETE", uri, null);

    if (response.success) {
        System.log("[f5DeleteMonitor] Deleted successfully: " + name);
        return { success: true, statusCode: response.statusCode };
    } else {
        System.error("[f5DeleteMonitor] Delete failed for: " + name);
        return { success: false, statusCode: response.statusCode };
    }
}


/**
 * --- Action: f5ListMonitors ---
 * Lists all monitors of a given type.
 *
 * Inputs:
 *   session    (object) - Session from f5Login
 *   type       (string) - Monitor type: "http", "https", "tcp", "gateway-icmp"
 *
 * Output:
 *   result (Array) - Array of monitor objects
 */
function f5ListMonitors(session, type) {
    if (!type || type.trim() === "") {
        throw new Error("f5ListMonitors: type is required.");
    }

    type = type.toLowerCase();
    var basePath = F5_MONITOR_TYPES[type];
    if (!basePath) {
        throw new Error("f5ListMonitors: Unsupported monitor type: " + type);
    }

    System.log("[f5ListMonitors] Fetching all " + type + " monitors...");

    var response = f5MakeRequest(session, "GET", basePath, null);

    if (response.success && response.body && response.body.items) {
        var monitors = response.body.items;
        System.log("[f5ListMonitors] Found " + monitors.length + " " + type + " monitor(s).");
        for (var i = 0; i < monitors.length; i++) {
            System.log("  [" + (i + 1) + "] " + monitors[i].fullPath + " (interval: " + monitors[i].interval + "s)");
        }
        return monitors;
    }

    System.warn("[f5ListMonitors] No " + type + " monitors found.");
    return [];
}
