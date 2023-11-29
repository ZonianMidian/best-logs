const ioredis = require('ioredis');
const utils = this;

exports.formatUsername = (username) => {
    return username.replace('@', '').replace(',', '').replace('#', '').toLowerCase();
};

exports.redis = new ioredis();
