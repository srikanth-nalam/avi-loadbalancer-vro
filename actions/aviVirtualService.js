/**
 * AVI Virtual Service CRUD Actions
 * ==================================
 * Create, Read, Update, Delete operations for AVI Virtual Services.
 *
 * A Virtual Service is the top-level object that ties together a VIP (VsVip),
 * a pool of backend servers, and optional profiles/policies. It is the
 * primary entry point for load-balanced traffic.
 *
 * @module com.vmware.avi.virtualservice
 * @version 1.0.0
 * @compatible VCF 9 / vRO 8.x
 *
 * AVI API Endpoint: /api/virtualservice
 *
 * Application Profile Types:
 *   - APPLICATION_PROFILE_TYPE_L4     (TCP/UDP passthrough)
 *   - APPLICATION_PROFILE_TYPE_HTTP   (HTTP/HTTPS with advanced features)
 *   - APPLICATION_PROFILE_TYPE_DNS    (DNS load balancing)
 *   - APPLICATION_PROFILE_TYPE_SSL    (SSL bridging/offloading)
 *
 * Dependencies:
 *   - aviAuth.js   (aviMakeRequest helper)
 *   - aviPool.js   (createPool for backend servers)
 *   - aviVsVip.js  (createVsVip for frontend VIP)
 */


/**
 * --- Action: createVirtualService ---
 * Creates a new Virtual Service on the AVI Controller.
 * This ties together a VsVip (frontend VIP) and a Pool (backend servers).
 *
 * Inputs:
 *   restHost              (REST:RESTHost) - Authenticated REST host
 *   apiVersion            (string)        - AVI API version (e.g., "22.1.1")
 *   name                  (string)        - Virtual service name (e.g., "VS-WebApp-Prod")
 *   vsvipRef              (string)        - VsVip URL ref (e.g., "/api/vsvip/<uuid>")
 *   poolRef               (string)        - Pool URL ref (e.g., "/api/pool/<uuid>")
 *   servicePort           (number)        - Service port to listen on (default: 80)
 *   serviceProtocol       (string)        - "TCP" or "UDP" (default: "TCP")
 *   applicationProfileRef (string|null)   - Application profile URL ref.
 *                                            If null, uses system-default-http.
 *   networkProfileRef     (string|null)   - Network profile URL ref.
 *   sslEnabled            (boolean)       - Enable SSL termination (default: false)
 *   sslProfileRef         (string|null)   - SSL profile URL ref (required if sslEnabled)
 *   sslCertRef            (string|null)   - SSL cert URL ref (required if sslEnabled)
 *   cloudRef              (string|null)   - Cloud URL ref
 *   seGroupRef            (string|null)   - SE Group URL ref
 *
 * Output:
 *   result (object) - { uuid: string, name: string, url: string, success: boolean, statusCode: number }
 */
function createVirtualService(restHost, apiVersion, name, vsvipRef, poolRef,
                               servicePort, serviceProtocol, applicationProfileRef,
                               networkProfileRef, sslEnabled, sslProfileRef,
                               sslCertRef, cloudRef, seGroupRef) {

    // Input validation
    if (!name || name.trim() === "") {
        throw new Error("createVirtualService: name is required.");
    }
    if (!vsvipRef || vsvipRef.trim() === "") {
        throw new Error("createVirtualService: vsvipRef is required.");
    }
    if (!poolRef || poolRef.trim() === "") {
        throw new Error("createVirtualService: poolRef is required.");
    }

    // Defaults
    servicePort = servicePort || 80;
    serviceProtocol = serviceProtocol || "TCP";
    sslEnabled = sslEnabled || false;

    System.log("[createVirtualService] Creating Virtual Service: " + name);
    System.log("[createVirtualService] VsVip ref: " + vsvipRef);
    System.log("[createVirtualService] Pool ref: " + poolRef);
    System.log("[createVirtualService] Port: " + servicePort + " (" + serviceProtocol + ")");

    // Build services array (which ports/protocols the VS listens on)
    var services = [{
        "port": servicePort,
        "enable_ssl": sslEnabled
    }];

    // Build payload
    var payload = {
        "name": name,
        "description": "Created by vRO Automation",
        "vsvip_ref": vsvipRef,
        "pool_ref": poolRef,
        "services": services,
        "enabled": true
    };

    // Application profile — use system default if not provided
    if (applicationProfileRef && applicationProfileRef.trim() !== "") {
        payload.application_profile_ref = applicationProfileRef;
    }

    // Network profile
    if (networkProfileRef && networkProfileRef.trim() !== "") {
        payload.network_profile_ref = networkProfileRef;
    }

    // SSL settings
    if (sslEnabled) {
        if (sslProfileRef && sslProfileRef.trim() !== "") {
            payload.ssl_profile_ref = sslProfileRef;
        }
        if (sslCertRef && sslCertRef.trim() !== "") {
            payload.ssl_key_and_certificate_refs = [sslCertRef];
        }
        System.log("[createVirtualService] SSL enabled.");
    }

    // Cloud reference
    if (cloudRef && cloudRef.trim() !== "") {
        payload.cloud_ref = cloudRef;
    }

    // SE Group reference
    if (seGroupRef && seGroupRef.trim() !== "") {
        payload.se_group_ref = seGroupRef;
    }

    System.log("[createVirtualService] Payload: " + JSON.stringify(payload));

    // Make API call
    var response = aviMakeRequest(restHost, "POST", "/api/virtualservice", JSON.stringify(payload), apiVersion);

    if (response.success) {
        System.log("[createVirtualService] Created successfully. UUID: " + response.body.uuid);
        return {
            uuid: response.body.uuid,
            name: response.body.name,
            url: response.body.url,
            success: true,
            statusCode: response.statusCode
        };
    } else {
        System.error("[createVirtualService] Failed to create Virtual Service: " + name);
        return { uuid: null, name: name, url: null, success: false, statusCode: response.statusCode };
    }
}


/**
 * --- Action: getVirtualService ---
 * Reads a Virtual Service by name or UUID.
 *
 * Inputs:
 *   restHost    (REST:RESTHost) - Authenticated REST host
 *   apiVersion  (string)        - AVI API version
 *   nameOrUuid  (string)        - VS name or UUID
 *
 * Output:
 *   result (object) - Full virtual service object from AVI, or null if not found
 */
function getVirtualService(restHost, apiVersion, nameOrUuid) {
    if (!nameOrUuid || nameOrUuid.trim() === "") {
        throw new Error("getVirtualService: nameOrUuid is required.");
    }

    System.log("[getVirtualService] Fetching Virtual Service: " + nameOrUuid);

    // Try by name first
    var endpoint = "/api/virtualservice?name=" + encodeURIComponent(nameOrUuid);
    var response = aviMakeRequest(restHost, "GET", endpoint, null, apiVersion);

    if (response.success && response.body && response.body.count > 0) {
        var vs = response.body.results[0];
        System.log("[getVirtualService] Found: " + vs.name + " (UUID: " + vs.uuid + ")");
        System.log("[getVirtualService] Enabled: " + vs.enabled);

        // Log service ports
        if (vs.services) {
            for (var i = 0; i < vs.services.length; i++) {
                System.log("[getVirtualService] Service port: " + vs.services[i].port +
                           " (SSL: " + (vs.services[i].enable_ssl ? "Yes" : "No") + ")");
            }
        }

        // Log pool reference
        if (vs.pool_ref) {
            System.log("[getVirtualService] Pool: " + vs.pool_ref);
        }

        return vs;
    }

    // Try by UUID
    endpoint = "/api/virtualservice/" + nameOrUuid;
    response = aviMakeRequest(restHost, "GET", endpoint, null, apiVersion);

    if (response.success) {
        System.log("[getVirtualService] Found by UUID: " + response.body.name);
        return response.body;
    }

    System.warn("[getVirtualService] Virtual Service not found: " + nameOrUuid);
    return null;
}


/**
 * --- Action: updateVirtualService ---
 * Updates an existing Virtual Service.
 *
 * Common use cases:
 *   - Change pool (switch backend servers)
 *   - Enable/disable the VS
 *   - Add SSL termination
 *   - Change service port
 *
 * Inputs:
 *   restHost      (REST:RESTHost) - Authenticated REST host
 *   apiVersion    (string)        - AVI API version
 *   uuid          (string)        - Virtual Service UUID to update
 *   updateFields  (object)        - Fields to update. Examples:
 *     { enabled: false }                               // Disable VS
 *     { pool_ref: "/api/pool/<new-pool-uuid>" }        // Switch pool
 *     { services: [{ port: 443, enable_ssl: true }] }  // Add SSL
 *
 * Output:
 *   result (object) - { uuid: string, success: boolean, statusCode: number }
 */
function updateVirtualService(restHost, apiVersion, uuid, updateFields) {
    if (!uuid || uuid.trim() === "") {
        throw new Error("updateVirtualService: uuid is required.");
    }
    if (!updateFields) {
        throw new Error("updateVirtualService: updateFields is required.");
    }

    System.log("[updateVirtualService] Updating Virtual Service UUID: " + uuid);

    // GET current object (AVI requires full object for PUT)
    var endpoint = "/api/virtualservice/" + uuid;
    var getResponse = aviMakeRequest(restHost, "GET", endpoint, null, apiVersion);

    if (!getResponse.success) {
        throw new Error("updateVirtualService: Could not fetch existing Virtual Service: " + uuid);
    }

    var currentObj = getResponse.body;

    // Merge updates
    for (var key in updateFields) {
        if (updateFields.hasOwnProperty(key)) {
            currentObj[key] = updateFields[key];
            System.log("[updateVirtualService] Setting " + key + " = " + JSON.stringify(updateFields[key]));
        }
    }

    // PUT updated object
    var putResponse = aviMakeRequest(restHost, "PUT", endpoint, JSON.stringify(currentObj), apiVersion);

    if (putResponse.success) {
        System.log("[updateVirtualService] Updated successfully. UUID: " + putResponse.body.uuid);
        return { uuid: putResponse.body.uuid, success: true, statusCode: putResponse.statusCode };
    } else {
        System.error("[updateVirtualService] Update failed for UUID: " + uuid);
        return { uuid: uuid, success: false, statusCode: putResponse.statusCode };
    }
}


/**
 * --- Action: enableDisableVirtualService ---
 * Convenience action to enable or disable a Virtual Service.
 *
 * Inputs:
 *   restHost    (REST:RESTHost) - Authenticated REST host
 *   apiVersion  (string)        - AVI API version
 *   uuid        (string)        - Virtual Service UUID
 *   enabled     (boolean)       - true = enable, false = disable
 *
 * Output:
 *   result (object) - { uuid: string, enabled: boolean, success: boolean }
 */
function enableDisableVirtualService(restHost, apiVersion, uuid, enabled) {
    if (!uuid || uuid.trim() === "") {
        throw new Error("enableDisableVirtualService: uuid is required.");
    }

    var action = enabled ? "Enabling" : "Disabling";
    System.log("[enableDisableVirtualService] " + action + " Virtual Service UUID: " + uuid);

    var result = updateVirtualService(restHost, apiVersion, uuid, { "enabled": enabled });

    return {
        uuid: result.uuid,
        enabled: enabled,
        success: result.success
    };
}


/**
 * --- Action: deleteVirtualService ---
 * Deletes a Virtual Service by UUID.
 *
 * IMPORTANT: Delete the Virtual Service BEFORE deleting the VsVip and Pool
 * that it references. AVI will block deletion of referenced objects.
 *
 * Inputs:
 *   restHost    (REST:RESTHost) - Authenticated REST host
 *   apiVersion  (string)        - AVI API version
 *   uuid        (string)        - Virtual Service UUID to delete
 *
 * Output:
 *   result (object) - { success: boolean, statusCode: number }
 */
function deleteVirtualService(restHost, apiVersion, uuid) {
    if (!uuid || uuid.trim() === "") {
        throw new Error("deleteVirtualService: uuid is required.");
    }

    System.log("[deleteVirtualService] Deleting Virtual Service UUID: " + uuid);

    var response = aviMakeRequest(restHost, "DELETE", "/api/virtualservice/" + uuid, null, apiVersion);

    if (response.success) {
        System.log("[deleteVirtualService] Deleted successfully. UUID: " + uuid);
        return { success: true, statusCode: response.statusCode };
    } else {
        System.error("[deleteVirtualService] Delete failed for UUID: " + uuid);
        return { success: false, statusCode: response.statusCode };
    }
}


/**
 * --- Action: listVirtualServices ---
 * Lists all Virtual Services on the AVI Controller.
 *
 * Inputs:
 *   restHost    (REST:RESTHost) - Authenticated REST host
 *   apiVersion  (string)        - AVI API version
 *
 * Output:
 *   result (Array) - Array of virtual service objects
 */
function listVirtualServices(restHost, apiVersion) {
    System.log("[listVirtualServices] Fetching all Virtual Services...");

    var response = aviMakeRequest(restHost, "GET", "/api/virtualservice", null, apiVersion);

    if (response.success && response.body && response.body.results) {
        var vsList = response.body.results;
        System.log("[listVirtualServices] Found " + vsList.length + " Virtual Service(s).");
        for (var i = 0; i < vsList.length; i++) {
            var enabled = vsList[i].enabled ? "Enabled" : "Disabled";
            var portInfo = "";
            if (vsList[i].services && vsList[i].services.length > 0) {
                portInfo = " Port:" + vsList[i].services[0].port;
            }
            System.log("  [" + (i + 1) + "] " + vsList[i].name + " (" + enabled + portInfo + ") - UUID: " + vsList[i].uuid);
        }
        return vsList;
    }

    System.warn("[listVirtualServices] No Virtual Services found or request failed.");
    return [];
}


/**
 * --- Action: getVirtualServiceRuntime ---
 * Retrieves runtime status of a Virtual Service (oper_status, health, etc.).
 * Useful for checking if the VS is UP/DOWN after creation.
 *
 * Inputs:
 *   restHost    (REST:RESTHost) - Authenticated REST host
 *   apiVersion  (string)        - AVI API version
 *   uuid        (string)        - Virtual Service UUID
 *
 * Output:
 *   result (object|null) - Runtime status object, or null if not found
 */
function getVirtualServiceRuntime(restHost, apiVersion, uuid) {
    if (!uuid || uuid.trim() === "") {
        throw new Error("getVirtualServiceRuntime: uuid is required.");
    }

    System.log("[getVirtualServiceRuntime] Checking runtime status for VS: " + uuid);

    var endpoint = "/api/virtualservice/" + uuid + "/runtime";
    var response = aviMakeRequest(restHost, "GET", endpoint, null, apiVersion);

    if (response.success) {
        var runtime = response.body;

        // Log key runtime info
        if (runtime.oper_status) {
            System.log("[getVirtualServiceRuntime] Oper Status: " + runtime.oper_status.state);
            if (runtime.oper_status.reason) {
                System.log("[getVirtualServiceRuntime] Reason: " + runtime.oper_status.reason);
            }
        }
        if (runtime.percent_ses_up !== undefined) {
            System.log("[getVirtualServiceRuntime] SEs Up: " + runtime.percent_ses_up + "%");
        }

        return runtime;
    }

    System.warn("[getVirtualServiceRuntime] Could not fetch runtime for VS: " + uuid);
    return null;
}
