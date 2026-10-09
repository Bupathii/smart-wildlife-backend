const express = require('express');
const { protect, authorize } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');
const { createAnimal, listAnimals } = require('../controllers/animal.controller');

const router = express.Router();

router.use(protect);
router.get('/', authorize('ADMIN', 'PARK_MANAGER', 'RANGER_SUPERVISOR', 'RANGER', 'RESEARCHER'), listAnimals);
router.post('/', authorize('ADMIN', 'PARK_MANAGER'), upload.single('photo'), createAnimal);

module.exports = router;