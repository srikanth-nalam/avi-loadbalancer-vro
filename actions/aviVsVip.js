/**
 * AVI VsVip (Virtual Service VIP) CRUD Actions
 * ===============================================
 * Create, Read, Update, Delete operations for AVI VsVip objects.
 *
 * A VsVip defines the front-end Virtual IP address(es) that clients
 * connect to. It is referenced by a Virtual Service and determines
 * which IP + subnet the load balancer listens on.
 *
 * @module com.vmware.avi.vsvip
 * @version 1.0.0
 * @compatible VCF 9 / vRO 8.x
 *
 * AVI API Endpoint: /api/vsvip
 *
 * Dependencies:
 *   - aviAuth.js (aviMakeRequest helper)
 */


/**
 * --- Action: createVsVip ---
 * Creates a new VsVip (Virtual IP) on the AVI Controller.
 *
 * Inputs:
 *   restHost     (REST:RESTHost) - Authenticated REST host
 *   apiVersion   (string)        - AVI API version (e.g., "22.1.1")
 *   name         (string)        - VsVip name (e.g., "VsVip-WebApp-Prod")
 *   vipAddress   (string)        - Virtual IP address (e.g., "10.0.1.100")
 *   subnetMask   (number)        - Subnet mask in CIDR notation (e.g., 24)
 *   subnetAddr   (string|null)   - Subnet address (e.g., "10.0.1.0"). If null, derived from VIP.
 *   cloudRef     (string|null)   - Cloud URL ref (e.g., "/api/cloud/<uuid>")
 *   vrfRef       (string|null)   - VRF context URL ref (e.g., "/api/vrfcontext/<uuid>")
 *
 * Output:
 *   result (object) - { uuid: string, name: string, url: string, success: boolean, statusCode: number }
 */
function createVsVip(restHost, apiVersion, name, vipAddress, subnetMask, subnetAddr, cloudRef, vrfRef) {

    // Input validation
    if (!name || name.trim() === "") {
        throw new Error("createVsVip: name is required.");
    }
    if (!vipAddress || vipAddress.trim() === "") {
        throw new Error("createVsVip: vipAddress is required.");
    }

    // Defaults
    subnetMask = subnetMask || 24;

    // Derive subnet address if not provided
    if (!subnetAddr || subnetAddr.trim() === "") {
        var octets = vipAddress.split(".");
        if (octets.length === 4) {
            subnetAddr = octets[0] + "." + octets[1] + "." + octets[2] + ".0";
        } else {
            subnetAddr = vipAddress; // Fallback
        }
    }

    System.log("[createVsVip] Creating VsVip: " + name + " (VIP: " + vipAddress + "/" + subnetMask + ")");

    // Build the VIP object
    var vip = {
        "vip_id": "1",
        "ip_address": {
            "addr": vipAddress,
            "type": "V4"
        },
        "subnet": {
            "ip_addr": {
                "addr": subnetAddr,
                "type": "V4"
            },
            "mask": subnetMask
        }
    };

    // Build payload
    var payload = {
        "name": name,
        "vip": [vip],
        "description": "Created by vRO Automation"
    };

    // Attach cloud reference if provided
    if (cloudRef && cloudRef.trim() !== "") {
        payload.cloud_ref = cloudRef;
        System.log("[createVsVip] Cloud ref: " + cloudRef);
    }

    // Attach VRF context if provided
    if (vrfRef && vrfRef.trim() !== "") {
        payload.vrf_context_ref = vrfRef;
        System.log("[createVsVip] VRF ref: " + vrfRef);
    }

    System.log("[createVsVip] Payload: " + JSON.stringify(payload));

    // Make API call
    var response = aviMakeRequest(restHost, "POST", "/api/vsvip", JSON.stringify(payload), apiVersion);

    if (response.success) {
        System.log("[createVsVip] Created successfully. UUID: " + response.body.uuid);
        return {
            uuid: response.body.uuid,
            name: response.body.name,
            url: response.body.url,
            success: true,
            statusCode: response.statusCode
        };
    } else {
        System.error("[createVsVip] Failed to create VsVip: " + name);
        return { uuid: null, name: name, url: null, success: false, statusCode: response.statusCode };
    }
}


/**
 * --- Action: getVsVip ---
 * Reads a VsVip by name or UUID.
 *
 * Inputs:
 *   restHost    (REST:RESTHost) - Authenticated REST host
 *   apiVersion  (string)        - AVI API version
 *   nameOrUuid  (string)        - VsVip name or UUID
 *
 * Output:
 *   result (object) - Full VsVip object from AVI, or null if not found
 */
function getVsVip(restHost, apiVersion, nameOrUuid) {
    if (!nameOrUuid || nameOrUuid.trim() === "") {
        throw new Error("getVsVip: nameOrUuid is required.");
    }

    System.log("[getVsVip] Fetching VsVip: " + nameOrUuid);

    // Try by name first
    var endpoint = "/api/vsvip?name=" + encodeURIComponent(nameOrUuid);
    var response = aviMakeRequest(restHost, "GET", endpoint, null, apiVersion);

    if (response.success && response.body && response.body.count > 0) {
        var vsvip = response.body.results[0];
        System.log("[getVsVip] Found: " + vsvip.name + " (UUID: " + vsvip.uuid + ")");

        // Log VIP details
        if (vsvip.vip && vsvip.vip.length > 0) {
            for (var i = 0; i < vsvip.vip.length; i++) {
                System.log("[getVsVip] VIP " + (i + 1) + ": " + vsvip.vip[i].ip_address.addr);
            }
        }
        return vsvip;
    }

    // Try by UUID
    endpoint = "/api/vsvip/" + nameOrUuid;
    response = aviMakeRequest(restHost, "GET", endpoint, null, apiVersion);

    if (response.success) {
        System.log("[getVsVip] Found by UUID: " + response.body.name);
        return response.body;
    }

    System.warn("[getVsVip] VsVip not found: " + nameOrUuid);
    return null;
}


/**
 * --- Action: updateVsVip ---
 * Updates an existing VsVip (e.g., change VIP address, subnet).
 *
 * Inputs:
 *   restHost      (REST:RESTHost) - Authenticated REST host
 *   apiVersion    (string)        - AVI API version
 *   uuid          (string)        - VsVip UUID to update
 *   updateFields  (object)        - Fields to update
 *
 * Output:
 *   result (object) - { uuid: string, success: boolean, statusCode: number }
 */
function updateVsVip(restHost, apiVersion, uuid, updateFields) {
    if (!uuid || uuid.trim() === "") {
        throw new Error("updateVsVip: uuid is required.");
    }
    if (!updateFields) {
        throw new Error("updateVsVip: updateFields is required.");
    }

    System.log("[updateVsVip] Updating VsVip UUID: " + uuid);

    // GET current object (AVI requires full object for PUT)
    var endpoint = "/api/vsvip/" + uuid;
    var getResponse = aviMakeRequest(restHost, "GET", endpoint, null, apiVersion);

    if (!getResponse.success) {
        throw new Error("updateVsVip: Could not fetch existing VsVip: " + uuid);
    }

    var currentObj = getResponse.body;

    // Merge updates
    for (var key in updateFields) {
        if (updateFields.hasOwnProperty(key)) {
            currentObj[key] = updateFields[key];
            System.log("[updateVsVip] Setting " + key + " = " + JSON.stringify(updateFields[key]));
        }
    }

    // PUT updated object
    var putResponse = aviMakeRequest(restHost, "PUT", endpoint, JSON.stringify(currentObj), apiVersion);

    if (putResponse.success) {
        System.log("[updateVsVip] Updated successfully. UUID: " + putResponse.body.uuid);
        return { uuid: putResponse.body.uuid, success: true, statusCode: putResponse.statusCode };
    } else {
        System.error("[updateVsVip] Update failed for UUID: " + uuid);
        return { uuid: uuid, success: false, statusCode: putResponse.statusCode };
    }
}


/**
 * --- Action: deleteVsVip ---
 * Deletes a VsVip by UUID.
 *
 * Inputs:
 *   restHost    (REST:RESTHost) - Authenticated REST host
 *   apiVersion  (string)        - AVI API version
 *   uuid        (string)        - VsVip UUID to delete
 *
 * Output:
 *   result (object) - { success: boolean, statusCode: number }
 */
function deleteVsVip(restHost, apiVersion, uuid) {
    if (!uuid || uuid.trim() === "") {
        throw new Error("deleteVsVip: uuid is required.");
    }

    System.log("[deleteVsVip] Deleting VsVip UUID: " + uuid);

    var response = aviMakeRequest(restHost, "DELETE", "/api/vsvip/" + uuid, null, apiVersion);

    if (response.success) {
        System.log("[deleteVsVip] Deleted successfully. UUID: " + uuid);
        return { success: true, statusCode: response.statusCode };
    } else {
        System.error("[deleteVsVip] Delete failed for UUID: " + uuid);
        return { success: false, statusCode: response.statusCode };
    }
}


/**
 * --- Action: listVsVips ---
 * Lists all VsVips on the AVI Controller.
 *
 * Inputs:
 *   restHost    (REST:RESTHost) - Authenticated REST host
 *   apiVersion  (string)        - AVI API version
 *
 * Output:
 *   result (Array) - Array of VsVip objects
 */
function listVsVips(restHost, apiVersion) {
    System.log("[listVsVips] Fetching all VsVips...");

    var response = aviMakeRequest(restHost, "GET", "/api/vsvip", null, apiVersion);

    if (response.success && response.body && response.body.results) {
        var vsvips = response.body.results;
        System.log("[listVsVips] Found " + vsvips.length + " VsVip(s).");
        for (var i = 0; i < vsvips.length; i++) {
            var vipAddr = (vsvips[i].vip && vsvips[i].vip.length > 0) ? vsvips[i].vip[0].ip_address.addr : "N/A";
            System.log("  [" + (i + 1) + "] " + vsvips[i].name + " (VIP: " + vipAddr + ") - UUID: " + vsvips[i].uuid);
        }
        return vsvips;
    }

    System.warn("[listVsVips] No VsVips found or request failed.");
    return [];
}
