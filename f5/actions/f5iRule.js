/**
 * F5 BIG-IP iRule Management Actions
 * =====================================
 * Create, Read, Update, Delete operations for F5 iRules
 * and attach/detach iRules to/from Virtual Servers.
 *
 * iRules are F5's traffic scripting language (Tcl-based) that provide
 * granular control over traffic handling — URL routing, header manipulation,
 * rate limiting, security, and more.
 *
 * Common iRule use cases for ServiceNow automation:
 *   - HTTP redirect (80 → 443)
 *   - URL-based pool selection (content switching)
 *   - Header insertion (X-Forwarded-For, custom headers)
 *   - Maintenance mode page
 *   - Rate limiting per source IP
 *
 * @module com.f5.bigip.irule
 * @version 1.0.0
 * @compatible VCF 9 / vRO 8.x
 *
 * API Endpoint: /mgmt/tm/ltm/rule
 *
 * Dependencies:
 *   - f5Auth.js (f5MakeRequest, f5BuildUri)
 */


/**
 * --- Action: f5CreateiRule ---
 * Creates a new iRule on the F5 BIG-IP.
 *
 * Inputs:
 *   session    (object) - Session from f5Login
 *   name       (string) - iRule name (e.g., "irule-http-redirect")
 *   apiAnonymous (string) - iRule body (Tcl code). Example:
 *     "when HTTP_REQUEST {\n  HTTP::redirect https://[HTTP::host][HTTP::uri]\n}"
 *   partition  (string) - Partition (default: "Common")
 *
 * Output:
 *   result (object) - { name, fullPath, success, statusCode }
 */
function f5CreateiRule(session, name, apiAnonymous, partition) {
    // Input validation
    if (!name || name.trim() === "") {
        throw new Error("f5CreateiRule: name is required.");
    }
    if (!apiAnonymous || apiAnonymous.trim() === "") {
        throw new Error("f5CreateiRule: apiAnonymous (iRule body) is required.");
    }

    partition = partition || "Common";

    System.log("[f5CreateiRule] Creating iRule: " + name);

    var payload = {
        "name": name,
        "partition": partition,
        "apiAnonymous": apiAnonymous
    };

    var response = f5MakeRequest(session, "POST", "/mgmt/tm/ltm/rule", JSON.stringify(payload));

    if (response.success) {
        System.log("[f5CreateiRule] Created successfully: " + response.body.fullPath);
        return {
            name: response.body.name,
            fullPath: response.body.fullPath,
            success: true,
            statusCode: response.statusCode
        };
    } else {
        if (response.statusCode === 409) {
            System.warn("[f5CreateiRule] iRule already exists: " + name);
            return { name: name, fullPath: "/" + partition + "/" + name, success: true, statusCode: 409 };
        }
        System.error("[f5CreateiRule] Failed to create iRule: " + name);
        return { name: name, fullPath: null, success: false, statusCode: response.statusCode };
    }
}


/**
 * --- Action: f5GetiRule ---
 * Reads an iRule by name.
 *
 * Inputs:
 *   session    (object) - Session from f5Login
 *   name       (string) - iRule name
 *   partition  (string) - Partition (default: "Common")
 *
 * Output:
 *   result (object) - Full iRule object, or null if not found
 */
function f5GetiRule(session, name, partition) {
    if (!name || name.trim() === "") {
        throw new Error("f5GetiRule: name is required.");
    }
    partition = partition || "Common";

    System.log("[f5GetiRule] Fetching iRule: " + name);

    var uri = f5BuildUri("/mgmt/tm/ltm/rule", name, partition);
    var response = f5MakeRequest(session, "GET", uri, null);

    if (response.success) {
        System.log("[f5GetiRule] Found: " + response.body.fullPath);
        return response.body;
    }

    System.warn("[f5GetiRule] iRule not found: " + name);
    return null;
}


/**
 * --- Action: f5UpdateiRule ---
 * Updates an existing iRule (replaces the rule body).
 *
 * Inputs:
 *   session       (object) - Session from f5Login
 *   name          (string) - iRule name
 *   apiAnonymous  (string) - New iRule body
 *   partition     (string) - Partition (default: "Common")
 *
 * Output:
 *   result (object) - { name, success, statusCode }
 */
function f5UpdateiRule(session, name, apiAnonymous, partition) {
    if (!name || name.trim() === "") {
        throw new Error("f5UpdateiRule: name is required.");
    }
    if (!apiAnonymous || apiAnonymous.trim() === "") {
        throw new Error("f5UpdateiRule: apiAnonymous is required.");
    }
    partition = partition || "Common";

    System.log("[f5UpdateiRule] Updating iRule: " + name);

    var uri = f5BuildUri("/mgmt/tm/ltm/rule", name, partition);
    var response = f5MakeRequest(session, "PATCH", uri, JSON.stringify({ "apiAnonymous": apiAnonymous }));

    if (response.success) {
        System.log("[f5UpdateiRule] Updated successfully: " + name);
        return { name: response.body.name, success: true, statusCode: response.statusCode };
    } else {
        System.error("[f5UpdateiRule] Update failed for: " + name);
        return { name: name, success: false, statusCode: response.statusCode };
    }
}


/**
 * --- Action: f5DeleteiRule ---
 * Deletes an iRule. Must not be attached to any Virtual Server.
 *
 * Inputs:
 *   session    (object) - Session from f5Login
 *   name       (string) - iRule name
 *   partition  (string) - Partition (default: "Common")
 *
 * Output:
 *   result (object) - { success, statusCode }
 */
function f5DeleteiRule(session, name, partition) {
    if (!name || name.trim() === "") {
        throw new Error("f5DeleteiRule: name is required.");
    }
    partition = partition || "Common";

    System.log("[f5DeleteiRule] Deleting iRule: " + name);

    var uri = f5BuildUri("/mgmt/tm/ltm/rule", name, partition);
    var response = f5MakeRequest(session, "DELETE", uri, null);

    if (response.success) {
        System.log("[f5DeleteiRule] Deleted: " + name);
        return { success: true, statusCode: response.statusCode };
    } else {
        System.error("[f5DeleteiRule] Delete failed for: " + name);
        return { success: false, statusCode: response.statusCode };
    }
}


/**
 * --- Action: f5ListiRules ---
 * Lists all custom iRules.
 *
 * Inputs:
 *   session    (object) - Session from f5Login
 *   partition  (string) - Partition filter (null = all)
 *
 * Output:
 *   result (Array) - Array of iRule objects
 */
function f5ListiRules(session, partition) {
    System.log("[f5ListiRules] Fetching all iRules...");

    var endpoint = "/mgmt/tm/ltm/rule";
    if (partition) {
        endpoint += "?$filter=partition%20eq%20" + partition;
    }

    var response = f5MakeRequest(session, "GET", endpoint, null);

    if (response.success && response.body && response.body.items) {
        var rules = response.body.items;
        System.log("[f5ListiRules] Found " + rules.length + " iRule(s).");
        for (var i = 0; i < rules.length; i++) {
            System.log("  [" + (i + 1) + "] " + rules[i].fullPath);
        }
        return rules;
    }

    System.warn("[f5ListiRules] No iRules found.");
    return [];
}


/**
 * --- Action: f5AttachiRuleToVS ---
 * Attaches an iRule to an existing Virtual Server.
 *
 * Inputs:
 *   session    (object) - Session from f5Login
 *   vsName     (string) - Virtual Server name
 *   iRulePath  (string) - Full iRule path (e.g., "/Common/irule-http-redirect")
 *   partition  (string) - Partition (default: "Common")
 *
 * Output:
 *   result (object) - { success, rules (updated list) }
 */
function f5AttachiRuleToVS(session, vsName, iRulePath, partition) {
    if (!vsName) throw new Error("f5AttachiRuleToVS: vsName is required.");
    if (!iRulePath) throw new Error("f5AttachiRuleToVS: iRulePath is required.");
    partition = partition || "Common";

    System.log("[f5AttachiRuleToVS] Attaching iRule " + iRulePath + " to VS " + vsName);

    // Get current VS to read existing rules
    var vs = f5GetVirtualServer(session, vsName, partition);
    if (!vs) {
        throw new Error("f5AttachiRuleToVS: Virtual Server not found: " + vsName);
    }

    var currentRules = vs.rules || [];

    // Check if already attached
    for (var i = 0; i < currentRules.length; i++) {
        if (currentRules[i] === iRulePath) {
            System.warn("[f5AttachiRuleToVS] iRule already attached: " + iRulePath);
            return { success: true, rules: currentRules };
        }
    }

    // Add the new iRule
    currentRules.push(iRulePath);

    var result = f5UpdateVirtualServer(session, vsName, { "rules": currentRules }, partition);

    return {
        success: result.success,
        rules: currentRules
    };
}


/**
 * --- Action: f5DetachiRuleFromVS ---
 * Detaches an iRule from a Virtual Server.
 *
 * Inputs:
 *   session    (object) - Session from f5Login
 *   vsName     (string) - Virtual Server name
 *   iRulePath  (string) - Full iRule path to detach
 *   partition  (string) - Partition (default: "Common")
 *
 * Output:
 *   result (object) - { success, rules (updated list) }
 */
function f5DetachiRuleFromVS(session, vsName, iRulePath, partition) {
    if (!vsName) throw new Error("f5DetachiRuleFromVS: vsName is required.");
    if (!iRulePath) throw new Error("f5DetachiRuleFromVS: iRulePath is required.");
    partition = partition || "Common";

    System.log("[f5DetachiRuleFromVS] Detaching iRule " + iRulePath + " from VS " + vsName);

    var vs = f5GetVirtualServer(session, vsName, partition);
    if (!vs) {
        throw new Error("f5DetachiRuleFromVS: Virtual Server not found: " + vsName);
    }

    var currentRules = vs.rules || [];
    var filtered = [];

    for (var i = 0; i < currentRules.length; i++) {
        if (currentRules[i] !== iRulePath) {
            filtered.push(currentRules[i]);
        }
    }

    if (filtered.length === currentRules.length) {
        System.warn("[f5DetachiRuleFromVS] iRule not found on VS: " + iRulePath);
        return { success: true, rules: currentRules };
    }

    var result = f5UpdateVirtualServer(session, vsName, { "rules": filtered }, partition);

    return {
        success: result.success,
        rules: filtered
    };
}


// ====================================================================
// Pre-built iRule templates for ServiceNow catalog automation
// ====================================================================

/**
 * --- Helper: f5GetHttpRedirectiRule ---
 * Returns the Tcl code for an HTTP-to-HTTPS redirect iRule.
 *
 * Output:
 *   iRuleBody (string) - Tcl iRule code
 */
function f5GetHttpRedirectiRule() {
    return "when HTTP_REQUEST {\n" +
           "    HTTP::redirect https://[HTTP::host][HTTP::uri]\n" +
           "}";
}


/**
 * --- Helper: f5GetMaintenancePageiRule ---
 * Returns the Tcl code for a maintenance mode iRule.
 * When the pool has no active members, serves a static maintenance page.
 *
 * Inputs:
 *   message (string) - Custom maintenance message (optional)
 *
 * Output:
 *   iRuleBody (string) - Tcl iRule code
 */
function f5GetMaintenancePageiRule(message) {
    message = message || "Service is temporarily unavailable. Please try again later.";

    return "when HTTP_REQUEST {\n" +
           "    if { [active_members [LB::server pool]] == 0 } {\n" +
           "        HTTP::respond 503 content \"<html><body><h1>Maintenance</h1><p>" + message + "</p></body></html>\" Content-Type text/html\n" +
           "    }\n" +
           "}";
}


/**
 * --- Helper: f5GetXForwardedForiRule ---
 * Returns the Tcl code for an X-Forwarded-For header insertion iRule.
 *
 * Output:
 *   iRuleBody (string) - Tcl iRule code
 */
function f5GetXForwardedForiRule() {
    return "when HTTP_REQUEST {\n" +
           "    HTTP::header insert X-Forwarded-For [IP::client_addr]\n" +
           "}";
}
