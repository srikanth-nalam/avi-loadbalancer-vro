/**
 * F5 BIG-IP iControl REST — Authentication Actions
 * ===================================================
 * Token-based authentication, session management, and centralized
 * HTTP request helper for all F5 iControl REST API calls.
 *
 * F5 BIG-IP supports two auth methods:
 *   1. HTTP Basic Auth (username:password on every request)
 *   2. Token-Based Auth (recommended for automation — get token, use X-F5-Auth-Token header)
 *
 * This module uses Token-Based Authentication for security best practices.
 *
 * @module com.f5.bigip.auth
 * @version 1.0.0
 * @compatible VCF 9 / vRO 8.x
 *
 * Architecture Notes:
 *   - Base URL: https://<bigip-mgmt-ip>/mgmt/tm/ltm/...
 *   - Token endpoint: POST /mgmt/shared/authn/login
 *   - Token header: X-F5-Auth-Token
 *   - Token lifetime: 1200s (20 min) — refresh before expiry
 *   - Partitions: use ~<partition>~ in URIs (e.g., ~Common~my-pool)
 *   - PATCH for partial updates, PUT for full replacement
 *   - Transactions for atomic multi-step operations
 *
 * --- Action: f5Login ---
 * Inputs:
 *   bigIpHost   (string)       - BIG-IP management IP or FQDN
 *   username    (string)       - Admin username
 *   password    (SecureString) - Admin password
 *
 * Output:
 *   session (object) - { restHost, token, bigIpHost, partition }
 */
function f5Login(bigIpHost, username, password) {
    // Input validation
    if (!bigIpHost || bigIpHost.trim() === "") {
        throw new Error("f5Login: bigIpHost is required.");
    }
    if (!username || username.trim() === "") {
        throw new Error("f5Login: username is required.");
    }
    if (!password) {
        throw new Error("f5Login: password is required.");
    }

    System.log("[f5Login] Connecting to F5 BIG-IP: " + bigIpHost);

    // Step 1: Create a transient REST host
    var baseUrl = "https://" + bigIpHost;
    var tempHost = RESTHostManager.createHost("F5DynamicHost");
    var restHost = RESTHostManager.createTransientHostFrom(tempHost);
    restHost.url = baseUrl;

    // Step 2: Request a token via /mgmt/shared/authn/login
    var loginPayload = {
        "username": username,
        "password": password,
        "loginProviderName": "tmos"
    };

    var request = restHost.createRequest("POST", "/mgmt/shared/authn/login", JSON.stringify(loginPayload));
    request.contentType = "application/json";

    // Use Basic Auth for the token request only
    var authHeader = "Basic " + System.getModule("com.vmware.library.http-rest").encodeBase64(username + ":" + password);
    request.setHeader("Authorization", authHeader);

    var response = request.execute();
    var statusCode = response.statusCode;

    System.log("[f5Login] Token request status: " + statusCode);

    if (statusCode >= 300) {
        System.error("[f5Login] Authentication failed. Status: " + statusCode);
        System.error("[f5Login] Response: " + response.contentAsString);
        throw new Error("f5Login: Authentication failed with status " + statusCode);
    }

    // Step 3: Extract the token from response
    var body = JSON.parse(response.contentAsString);
    var token = body.token.token;

    if (!token || token === "") {
        throw new Error("f5Login: Token not found in authentication response.");
    }

    System.log("[f5Login] Token acquired. Expires in " + (body.token.expirationMicros ? "~20 minutes" : "default timeout") + ".");
    System.log("[f5Login] Authenticated to F5 BIG-IP: " + bigIpHost);

    // Return session object
    return {
        restHost: restHost,
        token: token,
        bigIpHost: bigIpHost,
        partition: "Common"   // Default partition
    };
}


/**
 * --- Action: f5Logout ---
 * Invalidates the auth token by deleting it from the token store.
 *
 * Inputs:
 *   session (object) - Session from f5Login
 *
 * Output:
 *   success (boolean) - true if logout succeeded
 */
function f5Logout(session) {
    if (!session || !session.token) {
        System.warn("[f5Logout] No session provided. Nothing to logout.");
        return true;
    }

    try {
        // DELETE the token to invalidate it
        var endpoint = "/mgmt/shared/authz/tokens/" + session.token;
        var request = session.restHost.createRequest("DELETE", endpoint, null);
        request.contentType = "application/json";
        request.setHeader("X-F5-Auth-Token", session.token);

        var response = request.execute();
        System.log("[f5Logout] Token invalidation status: " + response.statusCode);
        return true;
    } catch (e) {
        System.warn("[f5Logout] Token cleanup failed (non-critical): " + e.message);
        return false;
    }
}


/**
 * --- Action: f5RefreshToken ---
 * Extends the token timeout by patching its properties.
 * Call this if long-running operations may exceed the 20-minute default.
 *
 * Inputs:
 *   session      (object) - Session from f5Login
 *   timeoutSecs  (number) - New timeout in seconds (max 36000 = 10 hours)
 *
 * Output:
 *   success (boolean)
 */
function f5RefreshToken(session, timeoutSecs) {
    if (!session || !session.token) {
        throw new Error("f5RefreshToken: session is required.");
    }
    timeoutSecs = timeoutSecs || 3600; // Default 1 hour

    try {
        var endpoint = "/mgmt/shared/authz/tokens/" + session.token;
        var payload = { "timeout": timeoutSecs };

        var request = session.restHost.createRequest("PATCH", endpoint, JSON.stringify(payload));
        request.contentType = "application/json";
        request.setHeader("X-F5-Auth-Token", session.token);

        var response = request.execute();

        if (response.statusCode < 300) {
            System.log("[f5RefreshToken] Token timeout extended to " + timeoutSecs + " seconds.");
            return true;
        } else {
            System.warn("[f5RefreshToken] Failed to extend token. Status: " + response.statusCode);
            return false;
        }
    } catch (e) {
        System.warn("[f5RefreshToken] Token refresh failed: " + e.message);
        return false;
    }
}


/**
 * --- Helper: f5MakeRequest ---
 * Central HTTP request helper for all F5 iControl REST API calls.
 * Handles token auth, content type, error parsing, and partition-aware URIs.
 *
 * Inputs:
 *   session    (object)      - Session from f5Login { restHost, token, partition }
 *   method     (string)      - HTTP method: GET, POST, PUT, PATCH, DELETE
 *   endpoint   (string)      - API endpoint (e.g., "/mgmt/tm/ltm/pool")
 *   payload    (string|null) - JSON string body for POST/PUT/PATCH
 *
 * Output:
 *   result (object) - { statusCode: number, body: object|string, success: boolean }
 */
function f5MakeRequest(session, method, endpoint, payload) {
    if (!session || !session.restHost || !session.token) {
        throw new Error("f5MakeRequest: Valid session is required.");
    }
    if (!method || !endpoint) {
        throw new Error("f5MakeRequest: method and endpoint are required.");
    }

    // Create request
    var request = session.restHost.createRequest(method, endpoint, payload);
    request.contentType = "application/json";
    request.setHeader("Accept", "application/json");
    request.setHeader("X-F5-Auth-Token", session.token);

    System.log("[f5MakeRequest] " + method + " " + endpoint);

    // Execute
    var response = request.execute();
    var statusCode = response.statusCode;
    var responseBody = response.contentAsString;

    System.log("[f5MakeRequest] Response status: " + statusCode);

    // Parse response
    var parsedBody = null;
    try {
        if (responseBody && responseBody.trim() !== "") {
            parsedBody = JSON.parse(responseBody);
        }
    } catch (e) {
        System.warn("[f5MakeRequest] Response is not valid JSON: " + responseBody.substring(0, 200));
        parsedBody = responseBody;
    }

    var success = (statusCode >= 200 && statusCode < 300);

    if (!success) {
        System.error("[f5MakeRequest] Request failed. Status: " + statusCode);
        if (parsedBody && parsedBody.message) {
            System.error("[f5MakeRequest] Error: " + parsedBody.message);
        } else {
            System.error("[f5MakeRequest] Response: " + (responseBody || "").substring(0, 500));
        }
    }

    return {
        statusCode: statusCode,
        body: parsedBody,
        success: success
    };
}


/**
 * --- Helper: f5BuildUri ---
 * Constructs a partition-aware URI for F5 objects.
 * Converts "objectName" + "Common" → "~Common~objectName"
 *
 * Inputs:
 *   basePath   (string) - Base path (e.g., "/mgmt/tm/ltm/pool")
 *   name       (string) - Object name (e.g., "my-pool")
 *   partition  (string) - Partition (default: "Common")
 *
 * Output:
 *   uri (string) - Full URI (e.g., "/mgmt/tm/ltm/pool/~Common~my-pool")
 */
function f5BuildUri(basePath, name, partition) {
    partition = partition || "Common";

    if (!name || name.trim() === "") {
        return basePath;
    }

    // If name already contains partition prefix, use as-is
    if (name.indexOf("~") === 0 || name.indexOf("/") === 0) {
        return basePath + "/" + name.replace(/\//g, "~");
    }

    return basePath + "/~" + partition + "~" + name;
}


/**
 * --- Helper: f5CreateTransaction ---
 * Creates an atomic transaction for batch operations.
 * All commands within a transaction either succeed or fail together.
 *
 * Best Practice: Use transactions when creating interdependent objects
 * (e.g., Node + Pool + Pool Member + Virtual Server).
 *
 * Inputs:
 *   session (object) - Session from f5Login
 *
 * Output:
 *   transId (string) - Transaction ID for X-F5-REST-Coordination-Id header
 */
function f5CreateTransaction(session) {
    if (!session) {
        throw new Error("f5CreateTransaction: session is required.");
    }

    System.log("[f5CreateTransaction] Creating new transaction...");

    var response = f5MakeRequest(session, "POST", "/mgmt/tm/transaction", "{}");

    if (response.success && response.body && response.body.transId) {
        var transId = response.body.transId.toString();
        System.log("[f5CreateTransaction] Transaction created. ID: " + transId);
        return transId;
    }

    throw new Error("f5CreateTransaction: Failed to create transaction.");
}


/**
 * --- Helper: f5CommitTransaction ---
 * Commits (applies) a transaction, making all queued changes live.
 *
 * Inputs:
 *   session (object) - Session from f5Login
 *   transId (string) - Transaction ID from f5CreateTransaction
 *
 * Output:
 *   result (object) - { success: boolean, statusCode: number }
 */
function f5CommitTransaction(session, transId) {
    if (!session || !transId) {
        throw new Error("f5CommitTransaction: session and transId are required.");
    }

    System.log("[f5CommitTransaction] Committing transaction: " + transId);

    var payload = { "state": "VALIDATING" };
    var response = f5MakeRequest(session, "PATCH", "/mgmt/tm/transaction/" + transId, JSON.stringify(payload));

    if (response.success) {
        System.log("[f5CommitTransaction] Transaction committed successfully.");
        return { success: true, statusCode: response.statusCode };
    } else {
        System.error("[f5CommitTransaction] Transaction commit failed.");
        return { success: false, statusCode: response.statusCode };
    }
}


/**
 * --- Helper: f5MakeTransactionalRequest ---
 * Makes a request within an active transaction context.
 * Adds the X-F5-REST-Coordination-Id header.
 *
 * Inputs:
 *   session    (object) - Session from f5Login
 *   method     (string) - HTTP method
 *   endpoint   (string) - API endpoint
 *   payload    (string) - JSON body
 *   transId    (string) - Transaction ID
 *
 * Output:
 *   result (object) - { statusCode, body, success }
 */
function f5MakeTransactionalRequest(session, method, endpoint, payload, transId) {
    if (!transId) {
        throw new Error("f5MakeTransactionalRequest: transId is required.");
    }

    var request = session.restHost.createRequest(method, endpoint, payload);
    request.contentType = "application/json";
    request.setHeader("Accept", "application/json");
    request.setHeader("X-F5-Auth-Token", session.token);
    request.setHeader("X-F5-REST-Coordination-Id", transId);

    System.log("[f5MakeTransactionalRequest] TXN:" + transId + " | " + method + " " + endpoint);

    var response = request.execute();
    var statusCode = response.statusCode;
    var responseBody = response.contentAsString;

    var parsedBody = null;
    try {
        if (responseBody && responseBody.trim() !== "") {
            parsedBody = JSON.parse(responseBody);
        }
    } catch (e) {
        parsedBody = responseBody;
    }

    var success = (statusCode >= 200 && statusCode < 300);
    return { statusCode: statusCode, body: parsedBody, success: success };
}
