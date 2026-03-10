/**
 * AVI Controller Authentication Action
 * ======================================
 * Handles login/logout and CSRF token management for AVI REST API calls.
 *
 * This action creates a transient REST host, authenticates against the AVI
 * controller, and returns the authenticated REST host with session cookies.
 *
 * @module com.vmware.avi.auth
 * @version 1.0.0
 * @compatible VCF 9 / vRO 8.x
 *
 * --- Action: aviLogin ---
 * Inputs:
 *   controllerIp   (string)  - AVI Controller IP or FQDN (e.g., "avi-controller.lab.local")
 *   username        (string)  - AVI Controller username
 *   password        (SecureString) - AVI Controller password
 *   apiVersion      (string)  - AVI API version (e.g., "22.1.1" or "30.2.1")
 *
 * Output:
 *   restHost        (REST:RESTHost) - Authenticated transient REST host with session cookies
 */

// ===== aviLogin Action =====
function aviLogin(controllerIp, username, password, apiVersion) {
    // Input validation
    if (!controllerIp || controllerIp.trim() === "") {
        throw new Error("aviLogin: controllerIp is required.");
    }
    if (!username || username.trim() === "") {
        throw new Error("aviLogin: username is required.");
    }
    if (!password) {
        throw new Error("aviLogin: password is required.");
    }
    if (!apiVersion) {
        apiVersion = "22.1.1"; // Default AVI API version
    }

    System.log("[aviLogin] Connecting to AVI Controller: " + controllerIp);

    // Step 1: Create a transient REST host (no persistent host needed)
    var baseUrl = "https://" + controllerIp;
    var tempHost = RESTHostManager.createHost("AviDynamicHost");
    var restHost = RESTHostManager.createTransientHostFrom(tempHost);
    restHost.url = baseUrl;

    // Step 2: Build login payload
    var loginPayload = {
        "username": username,
        "password": password
    };

    // Step 3: Send POST /login to authenticate
    var request = restHost.createRequest("POST", "/login", JSON.stringify(loginPayload));
    request.contentType = "application/json";

    var response = request.execute();
    var statusCode = response.statusCode;

    System.log("[aviLogin] Login response status: " + statusCode);

    if (statusCode >= 300) {
        System.error("[aviLogin] Authentication failed. Status: " + statusCode);
        System.error("[aviLogin] Response: " + response.contentAsString);
        throw new Error("aviLogin: Authentication failed with status " + statusCode);
    }

    // The REST host now holds the session cookies (avi-sessionid, csrftoken)
    System.log("[aviLogin] Successfully authenticated to AVI Controller: " + controllerIp);

    return restHost;
}


/**
 * --- Action: aviGetCsrfToken ---
 * Extracts the CSRF token from the authenticated REST host cookies.
 * This token must be sent as X-CSRFToken header in all POST/PUT/PATCH/DELETE requests.
 *
 * Inputs:
 *   restHost  (REST:RESTHost) - Authenticated REST host from aviLogin
 *
 * Output:
 *   token     (string) - CSRF token value
 */
function aviGetCsrfToken(restHost) {
    if (!restHost) {
        throw new Error("aviGetCsrfToken: restHost is required.");
    }

    var cookies = restHost.getCookies();
    var token = "";

    for each (var cookie in cookies) {
        if (cookie.name === "csrftoken") {
            token = cookie.value;
            break;
        }
    }

    if (!token || token === "") {
        System.warn("[aviGetCsrfToken] CSRF token not found in cookies. Session may have expired.");
        throw new Error("aviGetCsrfToken: CSRF token not found. Please re-authenticate.");
    }

    System.log("[aviGetCsrfToken] CSRF token retrieved successfully.");
    return token;
}


/**
 * --- Action: aviLogout ---
 * Ends the authenticated session with the AVI controller.
 *
 * Inputs:
 *   restHost  (REST:RESTHost) - Authenticated REST host from aviLogin
 *
 * Output:
 *   success   (boolean) - true if logout succeeded
 */
function aviLogout(restHost) {
    if (!restHost) {
        System.warn("[aviLogout] No restHost provided. Nothing to logout.");
        return true;
    }

    try {
        var token = aviGetCsrfToken(restHost);
        var request = restHost.createRequest("POST", "/logout", null);
        request.setHeader("X-CSRFToken", token);
        request.setHeader("Referer", restHost.url);

        var response = request.execute();
        System.log("[aviLogout] Logout status: " + response.statusCode);
        return true;
    } catch (e) {
        System.warn("[aviLogout] Logout failed (non-critical): " + e.message);
        return false;
    }
}


/**
 * --- Helper: aviMakeRequest ---
 * Central HTTP request helper for all AVI API calls.
 * Handles headers, CSRF token, API versioning, and error parsing.
 *
 * Inputs:
 *   restHost    (REST:RESTHost) - Authenticated REST host
 *   method      (string)        - HTTP method: GET, POST, PUT, PATCH, DELETE
 *   endpoint    (string)        - API endpoint (e.g., "/api/pool")
 *   payload     (string|null)   - JSON string body for POST/PUT/PATCH, null for GET/DELETE
 *   apiVersion  (string)        - AVI API version header value
 *
 * Output:
 *   result (object) - { statusCode: number, body: object|string, success: boolean }
 */
function aviMakeRequest(restHost, method, endpoint, payload, apiVersion) {
    if (!restHost) {
        throw new Error("aviMakeRequest: restHost is required.");
    }
    if (!method || !endpoint) {
        throw new Error("aviMakeRequest: method and endpoint are required.");
    }
    if (!apiVersion) {
        apiVersion = "22.1.1";
    }

    // Get CSRF token for write operations
    var token = "";
    if (method !== "GET") {
        token = aviGetCsrfToken(restHost);
    }

    // Create request
    var request = restHost.createRequest(method, endpoint, payload);
    request.contentType = "application/json";
    request.setHeader("Accept", "application/json");
    request.setHeader("X-Avi-Version", apiVersion);

    // Set CSRF and Referer for write operations
    if (method !== "GET") {
        request.setHeader("X-CSRFToken", token);
        request.setHeader("Referer", restHost.url);
    }

    System.log("[aviMakeRequest] " + method + " " + endpoint);

    // Execute
    var response = request.execute();
    var statusCode = response.statusCode;
    var responseBody = response.contentAsString;

    System.log("[aviMakeRequest] Response status: " + statusCode);

    // Parse response
    var parsedBody = null;
    try {
        if (responseBody && responseBody.trim() !== "") {
            parsedBody = JSON.parse(responseBody);
        }
    } catch (e) {
        System.warn("[aviMakeRequest] Response is not valid JSON: " + responseBody.substring(0, 200));
        parsedBody = responseBody;
    }

    var success = (statusCode >= 200 && statusCode < 300);

    if (!success) {
        System.error("[aviMakeRequest] Request failed. Status: " + statusCode);
        System.error("[aviMakeRequest] Response: " + responseBody.substring(0, 500));
    }

    return {
        statusCode: statusCode,
        body: parsedBody,
        success: success
    };
}
