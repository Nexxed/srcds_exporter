FROM node:18-alpine

WORKDIR /srcds_exporter

COPY . .
RUN yarn install
RUN yarn build

CMD ["yarn", "start"]