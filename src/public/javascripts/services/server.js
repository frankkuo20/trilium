import utils from './utils.js';
import toastService from "./toast.js";

const REQUEST_LOGGING_ENABLED = false;

function getHeaders(headers) {
    // headers need to be lowercase because node.js automatically converts them to lower case
    // so hypothetical protectedSessionId becomes protectedsessionid on the backend
    // also avoiding using underscores instead of dashes since nginx filters them out by default
    const allHeaders = {
        ...{
            'trilium-source-id': glob.sourceId,
            'x-csrf-token': glob.csrfToken
        },
        ...headers
    };

    if (utils.isElectron()) {
        // passing it explicitely here because of the electron HTTP bypass
        allHeaders.cookie = document.cookie;
    }

    return allHeaders;
}

async function get(url, headers = {}) {
    return await call('GET', url, null, headers);
}

async function post(url, data, headers = {}) {
    return await call('POST', url, data, headers);
}

async function put(url, data, headers = {}) {
    return await call('PUT', url, data, headers);
}

async function remove(url, headers = {}) {
    return await call('DELETE', url, null, headers);
}

let i = 1;
const reqResolves = {};

let maxKnownSyncId = 0;

async function call(method, url, data, headers = {}) {
    let resp;

    if (utils.isElectron()) {
        const ipc = require('electron').ipcRenderer;
        const requestId = i++;

        resp = await new Promise((resolve, reject) => {
            reqResolves[requestId] = resolve;

            if (REQUEST_LOGGING_ENABLED) {
                console.log(utils.now(), "Request #" + requestId + " to " + method + " " + url);
            }

            ipc.send('server-request', {
                requestId: requestId,
                headers: getHeaders(headers),
                method: method,
                url: "/" + baseApiUrl + url,
                data: data
            });
        });
    }
    else {
        resp = await ajax(url, method, data, headers);
    }

    const maxSyncIdStr = resp.headers['trilium-max-sync-id'];

    if (maxSyncIdStr && maxSyncIdStr.trim()) {
        maxKnownSyncId = Math.max(maxKnownSyncId, parseInt(maxSyncIdStr));
    }

    return resp.body;
}

function ajax(url, method, data, headers) {
    return new Promise((res, rej) => {
        const options = {
            url: baseApiUrl + url,
            type: method,
            headers: getHeaders(headers),
            timeout: 60000,
            success: (body, textStatus, jqXhr) => {
                const respHeaders = {};

                jqXhr.getAllResponseHeaders().trim().split(/[\r\n]+/).forEach(line => {
                    const parts = line.split(': ');
                    const header = parts.shift();
                    respHeaders[header] = parts.join(': ');
                });

                res({
                    body,
                    headers: respHeaders
                });
            },
            error: (jqXhr, textStatus, error) => {
                const message = "Error when calling " + method + " " + url + ": " + textStatus + " - " + error;
                toastService.showError(message);
                toastService.throwError(message);

                rej(error);
            }
        };

        if (data) {
            try {
                options.data = JSON.stringify(data);
            } catch (e) {
                console.log("Can't stringify data: ", data, " because of error: ", e)
            }
            options.contentType = "application/json";
        }

        $.ajax(options);
    });
}

if (utils.isElectron()) {
    const ipc = require('electron').ipcRenderer;

    ipc.on('server-response', (event, arg) => {
        if (REQUEST_LOGGING_ENABLED) {
            console.log(utils.now(), "Response #" + arg.requestId + ": " + arg.statusCode);
        }

        reqResolves[arg.requestId]({
            body: arg.body,
            headers: arg.headers
        });

        delete reqResolves[arg.requestId];
    });
}

export default {
    get,
    post,
    put,
    remove,
    ajax,
    // don't remove, used from CKEditor image upload!
    getHeaders,
    getMaxKnownSyncId: () => maxKnownSyncId
};