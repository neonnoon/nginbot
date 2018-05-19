ARG NGINX_TAG=latest
FROM nginx:$NGINX_TAG
MAINTAINER http://github.com/neonnoon
WORKDIR /work

VOLUME ["/etc/letsencrypt"]

RUN apt-get update \
    && apt-get install -y certbot curl gnupg \
    && curl -sL https://deb.nodesource.com/setup_10.x | bash \
    && apt-get install -y nodejs

COPY package.json /work
RUN npm install

COPY certbot.cron /etc/cron.d/certbot
COPY . /work

ENV CERTBOT_STAGING "false"
ENV CERTBOT_EMAIL ""
ENV CERTBOT_PORT "8080"

EXPOSE  80 443

CMD ["./robot.sh"]
