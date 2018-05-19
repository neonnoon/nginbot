const NginxConfFile = require('nginx-conf').NginxConfFile;
const path = require('path');
const fs = require('fs');

var argv = require('minimist')(process.argv.slice(2), {
    default: {
        debug: false,
        dry: false,
        file: 'nginx.conf',
        modified_extension: '.modified',
        modified_path: '',
        proxy_location: '/.well-known/acme-challenge/',
        proxy_upstream: 'http://localhost:8080',
        tmp_cert_dir: '/tmp',
        final_cert_dir: '/etc/letsencrypt/live',
        cert_file: 'fullchain.pem',
        key_file: 'privkey.pem',
    }
});

function __getModifiedConfigFileName(file) {
    if (argv.modified_path) {
        file = path.join(argv.modified_path, path.basename(modifiedFile));
    }

    if (argv.modified_extension) {
        file += argv.modified_extension;
    }

    return file;
}

/* Finds servers that run HTTPS but do not have a certificate configured. */
function __serversWithSSLButNoCert(server) {
    return server.filter(s => s.listen._value.endsWith('ssl')).filter(
        s => typeof s.ssl_certificate === 'undefined' && typeof s.ssl_certificate_key === 'undefined'
    );
}

/* Finds servers that run HTTPS and have a temporary certificate configured. */
function __serversWithSSLAndTmpCert(server) {
    return server.filter(s => s.listen._value.endsWith('ssl')).filter(
        s => typeof s.ssl_certificate !== 'undefined' && typeof s.ssl_certificate_key !== 'undefined' &&
        s.ssl_certificate._value.startsWith(argv.tmp_cert_dir) && s.ssl_certificate_key._value.startsWith(argv.tmp_cert_dir)
    );
}

/* Finds servers that run HTTPS for a specific domain. */
function __serversWithHTTPForDomain(server, domain) {
    return server.filter(s => !s.listen._value.endsWith('ssl')).filter(
        s => s.server_name._value.split(/\s+/).includes(domain)
    );
}

/* Checks whether a server has a forward location already. */
function __serverContainsProxyLocation(server) {
    if (!server.location) {
        return false;
    }
    if (server.location.length) {
        return server.location.some(l => __isProxyLocation(l));
    } else {
        return __isProxyLocation(server.location);
    }
}

/* Checks whether a location matches the forward location specs. */
function __isProxyLocation(location) {
    return location._value === argv.proxy_location && typeof location.proxy_pass !== 'undefined' &&
        location.proxy_pass._value === argv.proxy_upstream;
}

/* Adds a server for all domains that do not already have one. */
function __addProxyServer(http, domains) {
    http._add('server');
    const server = http.server.length > 0 ?
        http.server.slice(-1)[0] :
        http.server;

    server._add('listen', '80');
    server._add('server_name', domains.join(' '));

    __addDefaultLocation(server);
    __addProxyLocation(server);
}

/* Adds a default location. */
function __addDefaultLocation(server) {
    server._add('location', '/');
    const location = server.location.length > 0 ?
        server.location.slice(-1)[0] :
        server.location;

    location._add('return', '444');
}

/* Adds the location to forward traffic to the upstream. */
function __addProxyLocation(server) {
    server._add('location', argv.proxy_location);
    const location = server.location.length > 0 ?
        server.location.slice(-1)[0] :
        server.location;

    location._add('proxy_pass', argv.proxy_upstream);
}

/* Determines certificate path. */
function __certAndKeyNameForServer(server, tmp) {
    const domain = server.server_name._value.split(/\s+/)[0];
    const cert_dir = tmp ? argv.tmp_cert_dir : argv.final_cert_dir;
    const cert = path.join(cert_dir, domain, argv.cert_file);
    const key = path.join(cert_dir, domain, argv.key_file)

    return {
        cert,
        key
    };
}

/* Adds a temporary certificate to the server config. */
function __addTmpCertificate(server) {
    const tmp = __certAndKeyNameForServer(server, true);

    server._add('ssl_certificate', tmp.cert);
    server._add('ssl_certificate_key', tmp.key);
}

/* Adds a final certificate to the server config. */
function __addFinalCertificate(server, remove) {
    const final = __certAndKeyNameForServer(server, false);

    if (remove) {
        server._remove('ssl_certificate');
        server._remove('ssl_certificate_key');
    }

    server._add('ssl_certificate', final.cert);
    server._add('ssl_certificate_key', final.key);
}

/* Finds servers that run HTTPS but do not have a certificate configured.
 * These servers are assumed to need a certificate.
 *
 * Prints one server per line, with comma-separated list of domains.
 */
function findServersToEnhance(http, server) {
    __serversWithSSLButNoCert(server).forEach(s => {
        process.stdout.write(s.server_name._value.split(/\s+/).join(',') + '\n');
    });
}

/* Finds servers that run HTTPS but only have a tmp cert.
 *
 * Prints one server per line, with comma-separated list of domains.
 */
function findServersWithTmpCerts(http, server) {
    __serversWithSSLAndTmpCert(server).forEach(s => {
        process.stdout.write(s.server_name._value.split(/\s+/).join(',') + '\n');
    });
}

/* Creates new servers and/or locations to forward to certbot standalone.
 */
function createForwardLocations(http, server) {
    const missingDomains = [];

    __serversWithSSLButNoCert(server).forEach(s => {
        var domains = s.server_name._value.split(/\s+/);
        domains.forEach(domain => {
            const existingServers = __serversWithHTTPForDomain(server, domain);

            if (existingServers.length > 0) {
                existingServers.forEach(s => {
                    if (__serverContainsProxyLocation(s)) {
                        return;
                    }

                    if (argv.debug) {
                        console.log(
                            `Adding location for domain ${domain} in server ${s.server_name._value}`
                        );
                    }

                    if (!argv.dry) {
                        __addProxyLocation(s);
                    }
                });
            } else {
                missingDomains.push(domain);
            }
        });
    });

    if (missingDomains.length > 0) {
        const domainsUnique = [...new Set(missingDomains)];

        if (argv.debug) {
            console.log(`Adding server for domains ${domainsUnique}`)
        }

        if (!argv.dry) {
            __addProxyServer(http, domainsUnique);
        }
    }
}


function __certAndKeyExists(info) {
    return fs.existsSync(info.cert) && fs.existsSync(info.key)
}

/*
 * Adds temporary certificates for servers that use ssl but do not have a cert.
 */
function addTmpOrExistingCertificates(http, server) {
    __serversWithSSLButNoCert(server).forEach(s => {
        const final = __certAndKeyNameForServer(s, false);

        if (__certAndKeyExists(final)) {
            if (argv.debug) {
                console.log(`Directly using final cert for server ${s.server_name._value}`);
            }

            if (!argv.dry) {
                __addFinalCertificate(s, false);
            }
        } else {
            if (argv.debug) {
                console.log(`Adding tmp cert for server ${s.server_name._value}`);
            }

            if (!argv.dry) {
                __addTmpCertificate(s);
            }
        }
    });
}

/*
 * Replaces temporary certificates with the final ones.
 */
function replaceTmpWithFinalCertificates(http, server) {
    __serversWithSSLAndTmpCert(server).forEach(s => {
        const final = __certAndKeyNameForServer(s, false);
        if (__certAndKeyExists(final)) {

            if (argv.debug) {
                console.log(`Replacing tmp with final cert for  server ${s.server_name._value}`);
            }

            if (!argv.dry) {
                __addFinalCertificate(s, true);
            }
        }
    });
}

function parseFile(readFileName, saveFileName, handleConfig) {
    NginxConfFile.create(readFileName, function(err, conf) {
        if (err) {
            console.error(`ERROR: can't parse ${readFileName}: ${err}`);
            return;
        }

        if (saveFileName && readFileName !== saveFileName) {
            conf.die(readFileName);
            conf.live(saveFileName);
        }

        if (typeof conf.nginx.http !== 'undefined') {
            if (typeof conf.nginx.http.server !== 'undefined') {
                handleConfig(conf.nginx.http, conf.nginx.http.server);
            }
        }
    });
}


(function run() {
    var command;
    if (argv._ && argv._.length == 1) {
        command = argv._[0];
    }

    var originalFile = argv.file;
    var modifiedFileIfExists = originalFile;
    var modifiedFile = __getModifiedConfigFileName(originalFile);
    if (originalFile != modifiedFile && fs.existsSync(modifiedFile)) {
        modifiedFileIfExists = modifiedFile;
    }

    switch (command) {
        case 'find-servers-to-enhance':
            parseFile(originalFile, null, findServersToEnhance);
            break;

        case 'find-servers-with-tmp-certs':
            parseFile(modifiedFileIfExists, null, findServersWithTmpCerts);
            break;

        case 'step1':
        case 'create-forward-locations':
            parseFile(modifiedFileIfExists, modifiedFile, createForwardLocations);
            break;

        case 'step2':
        case 'add-tmp-or-existing-certs':
            parseFile(modifiedFileIfExists, modifiedFile, addTmpOrExistingCertificates);
            break;

        case 'step3':
        case 'replace-tmp-with-final-certs':
            parseFile(modifiedFileIfExists, modifiedFile, replaceTmpWithFinalCertificates);
            break

        default:
            console.error('Usage: update-nginx-conf.js [options] command');
    }
})();