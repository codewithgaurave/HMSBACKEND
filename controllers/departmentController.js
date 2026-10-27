const Department = require('../models/Department');
const DoctorProfile = require('../models/DoctorProfile');
const AuditLog = require('../models/AuditLog');

// Default initial clinical departments
const DEFAULT_DEPARTMENTS = [
  {
    name: 'Cardiology & Vascular Care',
    code: 'CARD',
    description: 'Comprehensive adult and pediatric cardiac diagnostics, intensive coronary care, interventional catheterization, and post-op rehabilitation.',
    headOfDepartment: 'Dr. Sarah Jenkins',
    location: 'Building A, 2nd Floor (West Wing)',
    contactPhone: '9876543210',
    contactEmail: 'cardiology@hospital.com',
    status: 'active'
  },
  {
    name: 'Department of Neurosciences',
    code: 'NEURO',
    description: 'Advanced neurosurgery, stroke management, comprehensive epilepsy care, spine surgery, and neurological trauma critical units.',
    headOfDepartment: 'Dr. Michael Chang',
    location: 'Building B, 3rd Floor',
    contactPhone: '9876543211',
    contactEmail: 'neurology@hospital.com',
    status: 'active'
  },
  {
    name: 'Pediatric & Neonatal Care',
    code: 'PEDI',
    description: 'Full-spectrum child health, Level III Neonatal Intensive Care Unit (NICU), pediatric cardiology, and developmental pediatrics.',
    headOfDepartment: 'Dr. Emily Watson',
    location: 'Children’s Pavilion, Level 1',
    contactPhone: '9876543212',
    contactEmail: 'pediatrics@hospital.com',
    status: 'active'
  },
  {
    name: 'General OPD',
    code: 'OPD',
    description: 'Primary care triage, preventive wellness consultations, general internal medicine outpatient clinics, and immunization suites.',
    headOfDepartment: 'Dr. David Miller',
    location: 'Main Ambulatory Complex, Ground Floor',
    contactPhone: '9876543213',
    contactEmail: 'opd@hospital.com',
    status: 'active'
  },
  {
    name: 'Orthopedics & Joint Reconstruction',
    code: 'ORTHO',
    description: 'Robotic-assisted joint replacement, sports injury arthroscopy, musculoskeletal oncology, and trauma orthopedics.',
    headOfDepartment: 'Dr. Robert Torres',
    location: 'Building A, 1st Floor',
    contactPhone: '9876543214',
    contactEmail: 'ortho@hospital.com',
    status: 'active'
  }
];

// Seed default departments if database is empty
const ensureDefaultDepartments = async () => {
  try {
    const count = await Department.countDocuments();
    if (count === 0) {
      await Department.insertMany(DEFAULT_DEPARTMENTS);
      console.log('Seeded default hospital departments successfully.');
    }
  } catch (err) {
    console.error('Error auto-seeding departments:', err);
  }
};

// @desc    Get all hospital departments with optional filtering, search, and pagination
// @route   GET /api/departments
// @access  Private
exports.getDepartments = async (req, res, next) => {
  try {
    await ensureDefaultDepartments();

    const { search, status, all, page = 1, limit = 10 } = req.query;

    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
        { headOfDepartment: { $regex: search, $options: 'i' } },
        { location: { $regex: search, $options: 'i' } }
      ];
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    if (all === 'true') {
      const departments = await Department.find(query).sort({ name: 1 });
      return res.status(200).json({
        success: true,
        departments,
        total: departments.length
      });
    }

    const skip = (Number(page) - 1) * Number(limit);
    const total = await Department.countDocuments(query);
    const departments = await Department.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    // Get doctor counts for each department
    const deptNames = departments.map((d) => d.name);
    const doctorCounts = await DoctorProfile.aggregate([
      { $match: { department: { $in: deptNames } } },
      { $group: { _id: '$department', count: { $sum: 1 } } }
    ]);

    const countMap = doctorCounts.reduce((acc, curr) => {
      acc[curr._id] = curr.count;
      return acc;
    }, {});

    const enriched = departments.map((d) => ({
      ...d.toObject(),
      doctorCount: countMap[d.name] || 0
    }));

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      departments: enriched
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single department by ID
// @route   GET /api/departments/:id
// @access  Private
exports.getDepartmentById = async (req, res, next) => {
  try {
    const department = await Department.findById(req.params.id);
    if (!department) {
      return res.status(404).json({ success: false, message: 'Department not found.' });
    }

    const doctorCount = await DoctorProfile.countDocuments({ department: department.name });

    res.status(200).json({
      success: true,
      department: {
        ...department.toObject(),
        doctorCount
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new department
// @route   POST /api/departments
// @access  Private/Admin
exports.createDepartment = async (req, res, next) => {
  try {
    const {
      name,
      code,
      description,
      headOfDepartment,
      location,
      contactPhone,
      contactEmail,
      status
    } = req.body;

    if (!name || !code) {
      return res.status(400).json({
        success: false,
        message: 'Department Name and Unique Code are required.'
      });
    }

    const cleanName = name.trim();
    const cleanCode = code.trim().toUpperCase();

    // Check duplicate name or code
    const existing = await Department.findOne({
      $or: [
        { name: { $regex: `^${cleanName}$`, $options: 'i' } },
        { code: cleanCode }
      ]
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: existing.code === cleanCode
          ? `Department code '${cleanCode}' is already registered.`
          : `Department with name '${cleanName}' already exists.`
      });
    }

    const department = await Department.create({
      name: cleanName,
      code: cleanCode,
      description: description ? description.trim() : '',
      headOfDepartment: headOfDepartment ? headOfDepartment.trim() : '',
      location: location ? location.trim() : '',
      contactPhone: contactPhone ? contactPhone.trim() : '',
      contactEmail: contactEmail ? contactEmail.trim().toLowerCase() : '',
      status: status || 'active'
    });

    if (req.user) {
      await AuditLog.create({
        action: 'ADMIN_CREATED_DEPARTMENT',
        performedBy: req.user.id,
        role: req.user.role,
        targetEntity: 'Department',
        targetId: department._id.toString(),
        details: { name: department.name, code: department.code }
      });
    }

    res.status(201).json({
      success: true,
      message: `Department '${department.name}' created successfully.`,
      department
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update department
// @route   PUT /api/departments/:id
// @access  Private/Admin
exports.updateDepartment = async (req, res, next) => {
  try {
    const department = await Department.findById(req.params.id);
    if (!department) {
      return res.status(404).json({ success: false, message: 'Department not found.' });
    }

    const {
      name,
      code,
      description,
      headOfDepartment,
      location,
      contactPhone,
      contactEmail,
      status
    } = req.body;

    if (name) {
      const cleanName = name.trim();
      const duplicateName = await Department.findOne({
        _id: { $ne: department._id },
        name: { $regex: `^${cleanName}$`, $options: 'i' }
      });
      if (duplicateName) {
        return res.status(400).json({
          success: false,
          message: `Department name '${cleanName}' is already used by another department.`
        });
      }

      // If department name changed, sync doctors with old name
      const oldName = department.name;
      if (oldName !== cleanName) {
        await DoctorProfile.updateMany(
          { department: oldName },
          { department: cleanName }
        );
      }
      department.name = cleanName;
    }

    if (code) {
      const cleanCode = code.trim().toUpperCase();
      const duplicateCode = await Department.findOne({
        _id: { $ne: department._id },
        code: cleanCode
      });
      if (duplicateCode) {
        return res.status(400).json({
          success: false,
          message: `Department code '${cleanCode}' is already registered.`
        });
      }
      department.code = cleanCode;
    }

    if (description !== undefined) department.description = description.trim();
    if (headOfDepartment !== undefined) department.headOfDepartment = headOfDepartment.trim();
    if (location !== undefined) department.location = location.trim();
    if (contactPhone !== undefined) department.contactPhone = contactPhone.trim();
    if (contactEmail !== undefined) department.contactEmail = contactEmail.trim().toLowerCase();
    if (status !== undefined) department.status = status;

    await department.save();

    if (req.user) {
      await AuditLog.create({
        action: 'ADMIN_UPDATED_DEPARTMENT',
        performedBy: req.user.id,
        role: req.user.role,
        targetEntity: 'Department',
        targetId: department._id.toString(),
        details: { name: department.name, code: department.code }
      });
    }

    res.status(200).json({
      success: true,
      message: `Department '${department.name}' updated successfully.`,
      department
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete department
// @route   DELETE /api/departments/:id
// @access  Private/Admin
exports.deleteDepartment = async (req, res, next) => {
  try {
    const department = await Department.findById(req.params.id);
    if (!department) {
      return res.status(404).json({ success: false, message: 'Department not found.' });
    }

    // Check if any doctors belong to this department
    const doctorCount = await DoctorProfile.countDocuments({ department: department.name });
    if (doctorCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete department '${department.name}' because ${doctorCount} active physician(s) are assigned to it. Reassign or remove doctors before deleting.`
      });
    }

    await Department.findByIdAndDelete(req.params.id);

    if (req.user) {
      await AuditLog.create({
        action: 'ADMIN_DELETED_DEPARTMENT',
        performedBy: req.user.id,
        role: req.user.role,
        targetEntity: 'Department',
        targetId: department._id.toString(),
        details: { name: department.name, code: department.code }
      });
    }

    res.status(200).json({
      success: true,
      message: `Department '${department.name}' has been permanently deleted.`
    });
  } catch (error) {
    next(error);
  }
};
