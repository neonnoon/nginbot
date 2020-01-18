#!/bin/bash

[ -n "$1" ] && RUN_IN_BACKGROUND_AND_EXEC=$1

TMP_CERT_DIR="/tmp"
FINAL_CERT_DIR="/etc/letsencrypt/live"
CERT_FILE="fullchain.pem"
KEY_FILE="privkey.pem"

[ -n "$CERTBOT_PORT" ] || CERTBOT_PORT="8080"
PROXY_LOCATION="/.well-known/acme-challenge/"
PROXY_UPSTREAM="http://localhost:$CERTBOT_PORT"

NGINX_MAIN_CONFIG_FILE="/etc/nginx/nginx.conf"
NGINX_MODIFIED_EXTENSION=".modified"
NGINX_MODIFIED_CONFIG_FILE="$NGINX_MAIN_CONFIG_FILE$NGINX_MODIFIED_EXTENSION"

UPDATE_NGINX_CONF="node update-nginx-conf.js \
    --proxy_location=$PROXY_LOCATION \
    --proxy_upstream=$PROXY_UPSTREAM \
    --tmp_cert_dir=$TMP_CERT_DIR \
    --final_cert_dir=$FINAL_CERT_DIR \
    --cert_file=$CERT_FILE \
    --key_file=$KEY_FILE \
    --file=$NGINX_MAIN_CONFIG_FILE \
    --modified-extension=$NGINX_MODIFIED_EXTENSION \
    "

# Creates a self-signed tempoary certificate that's only valid for one day.
function create_selfsigned_cert() {
    local DOMAINS=$1
    local MAIN
    local SAN="subjectAltName="

    for domain in `echo $DOMAINS | sed 's/,/ /g'`; do
        if [ -z "$MAIN" ]; then
            MAIN=$domain
        fi

        SAN="${SAN}DNS:$domain,"
    done

    SAN=`echo $SAN | sed 's/,$//'`

    local TMP_CERT_FULL_DIR="$TMP_CERT_DIR/$MAIN"
    [ -d "$TMP_CERT_FULL_DIR" ] || mkdir -p $TMP_CERT_FULL_DIR

    openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
        -keyout "$TMP_CERT_FULL_DIR/$KEY_FILE" \
        -out "$TMP_CERT_FULL_DIR/$CERT_FILE" \
        -subj "/CN=$MAIN" \
        -config <(printf "distinguished_name=dummy\n[dummy]\n[SAN]\n$SAN") \
        -extensions SAN
}

# Creates a fully valid letsencrypt certificate with certbot.
function create_certbot_cert() {
    local DOMAINS=$1
    local DOMAIN_ARG=`echo $DOMAINS | sed -e 's/^/-d /' -e 's/,/ -d /g'`

    local STAGING_ARG
    local EMAIL_ARG

    [ "$CERTBOT_STAGING" = true ] && STAGING_ARG="--staging"
    [ -n "$CERTBOT_EMAIL" ] && EMAIL_ARG="--email $EMAIL" || EMAIL_ARG="--register-unsafely-without-email"

    certbot certonly --standalone \
        --non-interactive --agree-tos \
        --expand \
        --preferred-challenges http --http-01-port $CERTBOT_PORT \
        $STAGING_ARG $EMAIL_ARG $DOMAIN_ARG

    if [ $? -ne 0 ]; then
        echo "Could not get cert for  $DOMAINS" >&2
        return 1
    fi
}

# Prepares the configuration that nginx can actually be started and used to foward requests to certbot.
function create_tmp_certificates() {
    local SERVERS=$1

    while read -r SERVER; do
        create_selfsigned_cert $SERVER
    done <<< "$SERVERS"

}

# Creates the real certificates.
function create_final_certificates() {
    local SERVERS=$1

    while read -r SERVER; do
        create_certbot_cert $SERVER
    done <<< "$SERVERS"
}

function request_and_use_final_certs() {
    local SERVERS=$1

    # Just to give nginx time to start
    sleep 2

    create_final_certificates "$SERVERS"
    $UPDATE_NGINX_CONF replace-tmp-with-final-certs
    /etc/init.d/nginx reload
}

# Deletes modified configs
function reset_config() {
    rm -f $NGINX_MODIFIED_CONFIG_FILE
}

# Let's go

# If the config doesn't make any use of these awesome features, let it be.
SERVERS=`$UPDATE_NGINX_CONF find-servers-to-enhance`
if [ -n "$SERVERS" ]; then

    # Make sure there is no old config files around.
    reset_config

    # Creates forwaring locations such that the certbot backend can be reached for letsencrypt auth.
    $UPDATE_NGINX_CONF create-forward-locations

    # Updates the config to either use already existing final certs, or to use the generated tmp certs.
    $UPDATE_NGINX_CONF add-tmp-or-existing-certs

    # Create temporary certificates, so that nginx can start up.
    # Also HTTPS servers are basically reachable during that phase.
    MISSING_SERVERS=`$UPDATE_NGINX_CONF find-servers-with-tmp-certs`
    if [ -n "$MISSING_SERVERS" ]; then
        create_tmp_certificates "$MISSING_SERVERS"
    fi

    # Schedule certificate creation in background.
    request_and_use_final_certs "$SERVERS" &

    # Start nginx so that cerbot backends can be reached.
    if [ -z "$RUN_IN_BACKGROUND_AND_EXEC" ]; then
        exec nginx -c $NGINX_MODIFIED_CONFIG_FILE -g "daemon off;"
    else
        nginx -c $NGINX_MODIFIED_CONFIG_FILE
        exec $RUN_IN_BACKGROUND_AND_EXEC
    fi
else
    if [ -z "$RUN_IN_BACKGROUND_AND_EXEC" ]; then
        exec nginx -c $NGINX_MAIN_CONFIG_FILE -g "daemon off;"
    else
        nginx -c $NGINX_MAIN_CONFIG_FILE
        exec $RUN_IN_BACKGROUND_AND_EXEC
    fi
fi
