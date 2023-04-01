FROM node:18-alpine

WORKDIR /srcds_exporter

COPY . .
RUN yarn install

CMD ["yarn", "start"]