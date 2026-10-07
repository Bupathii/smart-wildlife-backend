const Animal = require('../models/Animal');
const { uploadBuffer, deleteCloudinaryImage } = require('../utils/cloudinaryUpload');

async function listAnimals(req, res) {
  try {
    const animals = await Animal.find({})
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, animals });
  } catch (error) {
    return res.status(500).json({
      message: error.message || 'Unable to load tracked animals',
    });
  }
}

async function createAnimal(req, res) {
  let uploadedPhoto;

  try {
    const {
      animalId,
      name,
      species,
      latitude,
      longitude,
    } = req.body || {};

    const normalizedAnimalId = String(animalId || '').trim().toUpperCase();
    const normalizedName = String(name || '').trim();
    const normalizedSpecies = String(species || '').trim();

    if (!normalizedAnimalId) {
      return res.status(400).json({ message: 'Animal ID is required' });
    }
    if (!normalizedName) {
      return res.status(400).json({ message: 'Animal name is required' });
    }
    if (!normalizedSpecies) {
      return res.status(400).json({ message: 'Animal species is required' });
    }

    const hasLatitude = latitude !== undefined && latitude !== null && String(latitude).trim() !== '';
    const hasLongitude = longitude !== undefined && longitude !== null && String(longitude).trim() !== '';
    if (hasLatitude !== hasLongitude) {
      return res.status(400).json({ message: 'Provide both latitude and longitude' });
    }

    let currentLocation;
    if (hasLatitude && hasLongitude) {
      const latitudeNumber = Number(latitude);
      const longitudeNumber = Number(longitude);
      if (!Number.isFinite(latitudeNumber) || latitudeNumber < -90 || latitudeNumber > 90) {
        return res.status(400).json({ message: 'Latitude must be between -90 and 90' });
      }
      if (!Number.isFinite(longitudeNumber) || longitudeNumber < -180 || longitudeNumber > 180) {
        return res.status(400).json({ message: 'Longitude must be between -180 and 180' });
      }
      currentLocation = {
        latitude: latitudeNumber,
        longitude: longitudeNumber,
        lastUpdated: new Date(),
      };
    }

    if (req.file) {
      const uploadResult = await uploadBuffer(
        req.file.buffer,
        'wildlife-animals',
        req.file.originalname
      );
      uploadedPhoto = {
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
      };
    }

    const animal = new Animal({
      animalId: normalizedAnimalId,
      name: normalizedName,
      species: normalizedSpecies,
      ...(currentLocation ? { currentLocation } : {}),
      ...(uploadedPhoto ? { photo: uploadedPhoto } : {}),
    });
    const savedAnimal = await animal.save();

    return res.status(201).json({
      success: true,
      animal: savedAnimal.toObject(),
    });
  } catch (error) {
    if (uploadedPhoto?.publicId) {
      try {
        await deleteCloudinaryImage(uploadedPhoto.publicId);
      } catch {}
    }

    if (error?.name === 'ValidationError') {
      return res.status(400).json({ message: error.message });
    }
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'An animal with this ID is already registered' });
    }
    return res.status(500).json({
      message: error.message || 'Unable to register animal',
    });
  }
}

module.exports = { listAnimals, createAnimal };