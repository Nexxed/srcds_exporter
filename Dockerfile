FROM node:16-alpine

WORKDIR /srcds_exporter

COPY . .
RUN yarn install

CMD ["yarn", "start"]