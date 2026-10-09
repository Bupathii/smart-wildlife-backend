const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const Animal = require('../src/models/Animal');
const cloudinary = require('../src/config/cloudinary');
const { createAnimal, listAnimals } = require('../src/controllers/animal.controller');
const { uploadBuffer, deleteCloudinaryImage } = require('../src/utils/cloudinaryUpload');

function createResponse() {
  return {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test('listAnimals returns registered animals', async () => {
  const originalFind = Animal.find;
  Animal.find = () => ({
    sort: () => ({
      lean: async () => [{ animalId: 'ELE001', name: 'Kandula', species: 'Elephant' }],
    }),
  });

  try {
    const res = createResponse();
    await listAnimals({}, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.animals[0].animalId, 'ELE001');
  } finally {
    Animal.find = originalFind;
  }
});

test('createAnimal registers an animal with its initial GPS coordinates', async () => {
  const originalSave = Animal.prototype.save;
  Animal.prototype.save = async function saveAnimal() {
    return this;
  };

  try {
    const res = createResponse();
    await createAnimal({
      body: {
        animalId: ' ele001 ',
        name: 'Kandula',
        species: 'Sri Lankan elephant',
        latitude: 7.8731,
        longitude: 80.7718,
      },
    }, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.animal.animalId, 'ELE001');
    assert.equal(res.payload.animal.currentLocation.latitude, 7.8731);
    assert.equal(res.payload.animal.currentLocation.longitude, 80.7718);
  } finally {
    Animal.prototype.save = originalSave;
  }
});

test('createAnimal rejects an incomplete GPS coordinate pair', async () => {
  const res = createResponse();
  await createAnimal({
    body: {
      animalId: 'ELE002',
      name: 'Muthu',
      species: 'Elephant',
      latitude: 7.8731,
    },
  }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.payload.message, /both latitude and longitude/i);
});

test('createAnimal stores uploaded photo metadata', async () => {
  const originalSave = Animal.prototype.save;
  const originalUploadStream = cloudinary.uploader.upload_stream;
  const cloudinaryEnvironment = [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
  ];
  const originalEnvironment = Object.fromEntries(
    cloudinaryEnvironment.map((key) => [key, process.env[key]])
  );
  Animal.prototype.save = async function saveAnimal() {
    return this;
  };
  cloudinaryEnvironment.forEach((key) => {
    process.env[key] = `test-${key.toLowerCase()}`;
  });
  cloudinary.uploader.upload_stream = (options, callback) => ({
    end() {
      callback(null, {
        secure_url: 'https://images.example.test/elephant.jpg',
        public_id: 'wildlife-animals/elephant',
      });
    },
  });

  try {
    const res = createResponse();
    await createAnimal({
      body: { animalId: 'ELE003', name: 'Sena', species: 'Elephant' },
      file: { buffer: Buffer.from('test image') },
    }, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.animal.photo.url, 'https://images.example.test/elephant.jpg');
    assert.equal(res.payload.animal.photo.publicId, 'wildlife-animals/elephant');
  } finally {
    Animal.prototype.save = originalSave;
    cloudinary.uploader.upload_stream = originalUploadStream;
    cloudinaryEnvironment.forEach((key) => {
      if (originalEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnvironment[key];
    });
  }
});

test('uploadBuffer stores images locally when Cloudinary is not configured', async () => {
  const cloudinaryEnvironment = [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
  ];
  const originalEnvironment = Object.fromEntries(
    [...cloudinaryEnvironment, 'UPLOAD_DIR'].map((key) => [key, process.env[key]])
  );
  const uploadDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'wildlife-uploads-'));
  cloudinaryEnvironment.forEach((key) => delete process.env[key]);
  process.env.UPLOAD_DIR = uploadDirectory;

  try {
    const upload = await uploadBuffer(
      Buffer.from('test image'),
      'wildlife-animals',
      'elephant.webp'
    );
    const localPath = path.join(
      uploadDirectory,
      upload.public_id.replace(/^local:/, '')
    );

    assert.match(upload.secure_url, /^\/uploads\/wildlife-animals\/.+\.webp$/);
    assert.equal((await fs.stat(localPath)).isFile(), true);

    await deleteCloudinaryImage(upload.public_id);
    await assert.rejects(fs.access(localPath));
  } finally {
    [...cloudinaryEnvironment, 'UPLOAD_DIR'].forEach((key) => {
      if (originalEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnvironment[key];
    });
    await fs.rm(uploadDirectory, { recursive: true, force: true });
  }
});