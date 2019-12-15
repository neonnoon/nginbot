FROM nginx:1.17
MAINTAINER http://github.com/neonnoon
WORKDIR /work

ENV NODE_VERSION 12

VOLUME ["/etc/letsencrypt"]

RUN apt-get update \
    && apt-get install -y certbot curl gnupg cron

RUN curl -sSL https://deb.nodesource.com/gpgkey/nodesource.gpg.key | apt-key add - \
    && echo "deb https://deb.nodesource.com/node_${NODE_VERSION}.x buster main" | tee /etc/apt/sources.list.d/nodesource.list \
    && echo "deb-src https://deb.nodesource.com/node_${NODE_VERSION}.x buster main" | tee -a /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install nodejs

COPY package.json /work
RUN npm install

COPY certbot.cron /etc/cron.d/certbot
RUN crontab /etc/cron.d/certbot

COPY . /work

ENV CERTBOT_STAGING "false"
ENV CERTBOT_EMAIL ""
ENV CERTBOT_PORT "8080"

EXPOSE  80 443

CMD ["./robot.sh"]
