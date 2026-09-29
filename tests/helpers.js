function createResponse() {
  return {
    statusCode: 200,
    body: undefined,

    status(code) {
      this.statusCode = code;
      return this;
    },

    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createNext() {
  const calls = [];

  const next = (error) => {
    calls.push(error);
  };

  next.calls = calls;

  return next;
}

function makeQuery(
  result,
  { rejectWith } = {}
) {
  const query = {
    populate() {
      return this;
    },

    sort() {
      return this;
    },

    skip() {
      return this;
    },

    limit() {
      return this;
    },

    withArchived() {
      return this;
    },

    exec() {
      return rejectWith
        ? Promise.reject(
            rejectWith
          )
        : Promise.resolve(
            result
          );
    },

    then(
      resolve,
      reject
    ) {
      return this
        .exec()
        .then(
          resolve,
          reject
        );
    },

    catch(reject) {
      return this
        .exec()
        .catch(
          reject
        );
    },
  };

  return query;
}

module.exports = {
  createResponse,
  createNext,
  makeQuery,
};