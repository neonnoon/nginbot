Docker container for *nginx* that automatically creates *Let's Encrypt* certificates for your HTTPS servers.


## Basics

`nginbot` automatically creates certificates for all servers in your `nginx.conf` that use HTTPS but do not already have a certificate configured.

For a server that is already running HTTP, all you need to turn it into HTTPS as well, is adding the following line to the server block:
```
listen 443 ssl;
```


## Options

| Environment Variable | Default | Purpose |
| -------- | ------- | ------- |
 `-e CERTBOT_STAGING=true` | `false` | Use staging mode if `true`.
 `-e CERTBOT_EMAIL=<>`   | `""`    | Email address to use for registration of the certificate. It's recommended to provide an email address.
 `-e CERTBOT_PORT=<>`    | `8080`  | Port on which certbot will be running, change this if port `8080` is already in use. From external, certbot always needs to be reachable on port `80`. This cannot be changed.

## Extend Container

Wanna run something other than `nginx` in the container? Wanna run `nginx` in the background and start your own command? Just pass the command as an argument to `robot.sh`:

```
CMD ["./robot.sh", "your-command"]
```

## Persistent Certificates

Normally, a container based on `nginbot` will persist certificates and certbot data in a volume under `/etc/letsencrypt`.
In order to share this data among multiple containers, or when deleting and recreating containers, this directory can be mounted:

```
-v /etc/letsencrypt:/etc/letsencrypt
```

This option is definitely recommended if you're updating containers frequently, or if you have multiple replicas, see https://letsencrypt.org/docs/rate-limits/.


## Details

`nginbot` proceeds roughly like so:
1. parses `nginx.conf`, and looks for HTTPS servers without certificates.
2. changes `nginx.conf` to allow Let's Encrypt certbot auth requests to pass to a standalone certbot
4. orders Let's Encrypt certificates
5. changes `nginx.conf` to use Let's Encrypt certificates

More details? Well then check out `robot.sh`  and `update-nginx-conf.js`.


## Questions

Why? --- Running certbot yourself, running a separate certbot container, letting certbot fiddle with your mounted webroot all just didn't feel easy enough.

Why use nodejs to change `nginx.conf`? --- Good question, turns out this is the simplest module in any language I could find to change `nginx` configurations.

Why not [Caddy](https://caddyserver.com) or [Traefik](https://traefik.io)? --- They look interesting indeed. If I was starting a new project, I'd definitely check them out, to migrate existing projects, it's just too much effort.


## Credits

Similar stuff, very similar stuff, and other help.

* https://github.com/umputun/nginx-le
* https://github.com/JrCs/docker-letsencrypt-nginx-proxy-companion


## Missing Stuff

Missing pieces and functionality, stuff that's so great yet.

* `nginbot` has  been written to do its job, but it's rather quick and dirty. Be warned!
* `nginbot` needs to modify your `nginx` config, to do that it creates a copy in the same folder, that's not so nice if that's a shared/mounted folder.
* `nginbot` is not yet able to handle server configurations in included files
