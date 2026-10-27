const LabTest = require('../models/LabTest');
const LabRequest = require('../models/LabRequest');
const LabResult = require('../models/LabResult');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const path = require('path');
const fs = require('fs');

// ==================== 1. LAB DASHBOARD STATISTICS ==================== //

// @desc    Get real-time lab dashboard statistics & workload metrics
// @route   GET /api/lab/dashboard-stats
// @access  Private (Lab Staff, Admin)
exports.getLabDashboardStats = async (req, res, next) => {
  try {
    const isLabStaff = req.user.role === 'lab';

    // Base query: parallel counts
    const [
      totalAssigned,
      pendingRequests,
      sampleCollected,
      processing,
      completed,
      published,
      rejected,
      catalogCount,
      priorityNormal,
      priorityUrgent,
      priorityStat
    ] = await Promise.all([
      LabRequest.countDocuments(),
      LabRequest.countDocuments({ status: { $in: ['Requested', 'Accepted'] } }),
      LabRequest.countDocuments({ status: 'Sample Collected' }),
      LabRequest.countDocuments({ status: 'Processing' }),
      LabRequest.countDocuments({ status: 'Completed' }),
      LabRequest.countDocuments({ status: 'Published' }),
      LabRequest.countDocuments({ status: 'Rejected' }),
      LabTest.countDocuments({ isActive: true }),
      LabRequest.countDocuments({ priority: 'Normal' }),
      LabRequest.countDocuments({ priority: 'Urgent' }),
      LabRequest.countDocuments({ priority: 'Stat' })
    ]);

    // Awaiting review / release are tests that are completed or reviewed but not yet released
    const awaitingReview = await LabRequest.countDocuments({
      status: { $in: ['Completed', 'Reviewed'] }
    });

    // ==================== 1. DAILY 7-DAY SPECIMEN PIPELINE TREND ==================== //
    const now = new Date();
    const daysTrend = [];
    let weekTotal = 0;
    let prevWeekTotal = 0;

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const startOfDay = new Date(d.setHours(0, 0, 0, 0));
      const endOfDay = new Date(d.setHours(23, 59, 59, 999));
      const dayName = startOfDay.toLocaleDateString('en-US', { weekday: 'short' });

      const [intakeCount, releasedCount] = await Promise.all([
        LabRequest.countDocuments({
          createdAt: { $gte: startOfDay, $lte: endOfDay }
        }),
        LabRequest.countDocuments({
          status: 'Published',
          updatedAt: { $gte: startOfDay, $lte: endOfDay }
        })
      ]);

      weekTotal += intakeCount;

      daysTrend.push({
        day: dayName,
        date: startOfDay.toISOString().split('T')[0],
        intake: intakeCount,
        released: releasedCount
      });
    }

    // Previous 7-day window for trend badge calculation
    const prevWeekStart = new Date();
    prevWeekStart.setDate(now.getDate() - 13);
    prevWeekStart.setHours(0, 0, 0, 0);
    const prevWeekEnd = new Date();
    prevWeekEnd.setDate(now.getDate() - 7);
    prevWeekEnd.setHours(23, 59, 59, 999);

    prevWeekTotal = await LabRequest.countDocuments({
      createdAt: { $gte: prevWeekStart, $lte: prevWeekEnd }
    });

    let badgeText = `Released: ${published}`;
    let badgePositive = published > 0;
    if (weekTotal > prevWeekTotal && prevWeekTotal > 0) {
      const pct = Math.round(((weekTotal - prevWeekTotal) / prevWeekTotal) * 100);
      badgeText = `+${pct}% Intake Throughput`;
      badgePositive = true;
    } else if (weekTotal < prevWeekTotal && prevWeekTotal > 0) {
      const pct = Math.round(((prevWeekTotal - weekTotal) / prevWeekTotal) * 100);
      badgeText = `-${pct}% Specimen Load`;
      badgePositive = false;
    }

    // ==================== 2. MONTHLY 6-MONTH ROLLING WORKLOAD TIMELINE ==================== //
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyIntake = [];
    const monthlyCompletionBars = [];

    for (let m = 5; m >= 0; m--) {
      const mDate = new Date();
      mDate.setMonth(now.getMonth() - m);
      const mStart = new Date(mDate.getFullYear(), mDate.getMonth(), 1);
      const mEnd = new Date(mDate.getFullYear(), mDate.getMonth() + 1, 0, 23, 59, 59, 999);
      const mLabel = monthNames[mStart.getMonth()];

      const [mTotal, mReleased] = await Promise.all([
        LabRequest.countDocuments({
          createdAt: { $gte: mStart, $lte: mEnd }
        }),
        LabRequest.countDocuments({
          status: 'Published',
          $or: [
            { createdAt: { $gte: mStart, $lte: mEnd } },
            { updatedAt: { $gte: mStart, $lte: mEnd } }
          ]
        })
      ]);

      monthlyIntake.push({
        month: mLabel,
        total: mTotal,
        released: mReleased
      });

      monthlyCompletionBars.push({
        label: mLabel,
        val1: mTotal,
        val2: mReleased
      });
    }

    // ==================== 3. CATEGORY DISTRIBUTION AGGREGATION ==================== //
    const categoryAgg = await LabRequest.aggregate([
      {
        $lookup: {
          from: 'labtests',
          localField: 'labTest',
          foreignField: '_id',
          as: 'testInfo'
        }
      },
      { $unwind: { path: '$testInfo', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { $ifNull: ['$testInfo.category', 'General Pathology'] },
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    const catColors = ['#0E9FAD', '#6366F1', '#10B981', '#F59E0B', '#EC4899'];
    const categoriesDistribution = categoryAgg.map((c, i) => ({
      label: c._id || 'General Pathology',
      value: c.count,
      color: catColors[i % catColors.length]
    }));

    // ==================== 4. SPECIMEN SAMPLE TYPE AGGREGATION ==================== //
    const sampleAgg = await LabRequest.aggregate([
      {
        $group: {
          _id: { $ifNull: ['$sampleType', 'Blood / Serum'] },
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 4 }
    ]);

    const sampleColors = ['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B'];
    const sampleTypesDistribution = sampleAgg.map((s, i) => ({
      label: s._id && s._id.length > 18 ? s._id.substring(0, 16) + '...' : (s._id || 'Specimen'),
      value: s.count,
      color: sampleColors[i % sampleColors.length]
    }));

    res.status(200).json({
      success: true,
      stats: {
        totalAssigned,
        pendingRequests,
        sampleCollected,
        processing,
        completed,
        awaitingReview,
        published,
        rejected,
        catalogCount,
        priorityNormal,
        priorityUrgent,
        priorityStat
      },
      charts: {
        weeklyPipeline: {
          labels: daysTrend.map(d => d.day),
          data: daysTrend.map(d => d.intake),
          releasedData: daysTrend.map(d => d.released),
          badgeText,
          badgePositive
        },
        monthlyPipeline: {
          labels: monthlyIntake.map(m => m.month),
          data: monthlyIntake.map(m => m.total),
          releasedData: monthlyIntake.map(m => m.released)
        },
        monthlyCompletionBars,
        pipelineStages: [
          { label: 'Intake / Pending', value: pendingRequests, color: '#F59E0B' },
          { label: 'Sample Collected', value: sampleCollected, color: '#0E9FAD' },
          { label: 'Bench Testing', value: processing, color: '#6366F1' },
          { label: 'Awaiting Sign-off', value: awaitingReview, color: '#3B82F6' },
          { label: 'Released / Dispatched', value: published, color: '#10B981' },
          { label: 'Quality Rejected', value: rejected, color: '#F43F5E' }
        ],
        priorityDistribution: [
          { label: 'Routine (Normal)', value: priorityNormal, color: '#10B981' },
          { label: 'Urgent Priority', value: priorityUrgent, color: '#F59E0B' },
          { label: 'Stat / Critical Emergency', value: priorityStat, color: '#EF4444' }
        ],
        categoriesDistribution: categoriesDistribution.length > 0 ? categoriesDistribution : [
          { label: 'Hematology', value: published || 1, color: '#0E9FAD' },
          { label: 'Biochemistry', value: processing || 1, color: '#6366F1' }
        ],
        sampleTypesDistribution: sampleTypesDistribution.length > 0 ? sampleTypesDistribution : [
          { label: 'Blood (EDTA/Serum)', value: totalAssigned || 1, color: '#10B981' }
        ]
      }
    });
  } catch (error) {
    next(error);
  }
};

// ==================== 2. LAB TEST CATALOG ==================== //

// @desc    Get all available lab tests in catalog
// @route   GET /api/lab/tests
// @access  Public / Protected
exports.getLabTests = async (req, res, next) => {
  try {
    const { category, search, activeOnly } = req.query;
    const query = {};

    // Only filter active if explicitly set or for patient/unauthorized viewers
    if (activeOnly === 'true' || activeOnly === true || (!req.user || req.user.role === 'patient')) {
      query.isActive = true;
    } else if (activeOnly === 'false' || activeOnly === false) {
      // Show all including inactive for admin / lab staff
    }

    if (category && category !== 'All') {
      query.category = category;
    }

    if (search && search.trim()) {
      const s = search.trim();
      query.$or = [
        { testName: { $regex: s, $options: 'i' } },
        { testCode: { $regex: s, $options: 'i' } },
        { sampleType: { $regex: s, $options: 'i' } },
        { category: { $regex: s, $options: 'i' } }
      ];
    }

    const tests = await LabTest.find(query).sort({ category: 1, testName: 1 });
    res.status(200).json({ success: true, count: tests.length, tests });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single lab test details
// @route   GET /api/lab/tests/:id
// @access  Public / Protected
exports.getLabTestById = async (req, res, next) => {
  try {
    const test = await LabTest.findById(req.params.id);
    if (!test) {
      return res.status(404).json({ success: false, message: 'Lab test not found in catalog.' });
    }
    res.status(200).json({ success: true, test });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new lab test in catalog (Admin or Lab)
// @route   POST /api/lab/tests
// @access  Private (Admin, Lab)
exports.createLabTest = async (req, res, next) => {
  try {
    const {
      testName,
      testCode,
      category,
      price,
      turnaroundHours,
      sampleType,
      normalRange,
      units,
      description,
      preparationInstructions
    } = req.body;

    if (!testName || !testCode || !category || price === undefined || !sampleType) {
      return res.status(400).json({
        success: false,
        message: 'Please provide test name, unique test code, category, price, and specimen sample type.'
      });
    }

    const formattedCode = testCode.trim().toUpperCase();
    const existing = await LabTest.findOne({ testCode: formattedCode });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Test code "${formattedCode}" is already in use. Test codes must be unique.`
      });
    }

    const test = await LabTest.create({
      testName: testName.trim(),
      testCode: formattedCode,
      category: category.trim(),
      price: Number(price),
      turnaroundHours: turnaroundHours ? Number(turnaroundHours) : 24,
      sampleType: sampleType.trim(),
      normalRange: normalRange ? normalRange.trim() : 'Refer to report notes',
      units: units ? units.trim() : 'N/A',
      description: description ? description.trim() : '',
      preparationInstructions: preparationInstructions ? preparationInstructions.trim() : '',
      isActive: true
    });

    await AuditLog.create({
      action: 'LAB_TEST_CATALOG_CREATED',
      performedBy: req.user.id,
      role: req.user.role,
      targetEntity: 'LabTest',
      targetId: test._id.toString(),
      details: { testName: test.testName, testCode: test.testCode, price: test.price }
    });

    res.status(201).json({
      success: true,
      message: 'New diagnostic test added to catalog successfully.',
      test
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update lab test catalog item
// @route   PUT /api/lab/tests/:id
// @access  Private (Admin, Lab)
exports.updateLabTest = async (req, res, next) => {
  try {
    const { testCode } = req.body;

    if (testCode) {
      const formattedCode = testCode.trim().toUpperCase();
      const duplicate = await LabTest.findOne({
        testCode: formattedCode,
        _id: { $ne: req.params.id }
      });
      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: `Test code "${formattedCode}" is already in use by another test.`
        });
      }
      req.body.testCode = formattedCode;
    }

    const test = await LabTest.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    if (!test) {
      return res.status(404).json({ success: false, message: 'Lab test not found in catalog.' });
    }

    await AuditLog.create({
      action: 'LAB_TEST_CATALOG_UPDATED',
      performedBy: req.user.id,
      role: req.user.role,
      targetEntity: 'LabTest',
      targetId: test._id.toString(),
      details: { testName: test.testName, testCode: test.testCode }
    });

    res.status(200).json({
      success: true,
      message: 'Diagnostic test updated successfully.',
      test
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Toggle lab test active / inactive status
// @route   PATCH /api/lab/tests/:id/toggle-status
// @access  Private (Admin, Lab)
exports.toggleLabTestStatus = async (req, res, next) => {
  try {
    const test = await LabTest.findById(req.params.id);
    if (!test) {
      return res.status(404).json({ success: false, message: 'Lab test not found in catalog.' });
    }

    test.isActive = !test.isActive;
    await test.save();

    await AuditLog.create({
      action: 'LAB_TEST_STATUS_TOGGLED',
      performedBy: req.user.id,
      role: req.user.role,
      targetEntity: 'LabTest',
      targetId: test._id.toString(),
      details: { testCode: test.testCode, newStatus: test.isActive ? 'Active' : 'Inactive' }
    });

    res.status(200).json({
      success: true,
      message: `Test "${test.testName}" is now ${test.isActive ? 'Active' : 'Inactive'}.`,
      test
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete lab test catalog item
// @route   DELETE /api/lab/tests/:id
// @access  Private (Admin)
exports.deleteLabTest = async (req, res, next) => {
  try {
    const test = await LabTest.findById(req.params.id);
    if (!test) {
      return res.status(404).json({ success: false, message: 'Lab test not found in catalog.' });
    }

    // Check if test is referenced in pending lab requests
    const activeRequests = await LabRequest.countDocuments({
      labTest: test._id,
      status: { $in: ['Requested', 'Accepted', 'Sample Collected', 'Processing'] }
    });

    if (activeRequests > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete test: ${activeRequests} active specimen orders are currently in pipeline. Consider marking it Inactive instead.`
      });
    }

    await LabTest.findByIdAndDelete(req.params.id);

    await AuditLog.create({
      action: 'LAB_TEST_DELETED',
      performedBy: req.user.id,
      role: req.user.role,
      targetEntity: 'LabTest',
      targetId: test._id.toString(),
      details: { testName: test.testName, testCode: test.testCode }
    });

    res.status(200).json({
      success: true,
      message: `Diagnostic test "${test.testName}" removed from hospital catalog.`
    });
  } catch (error) {
    next(error);
  }
};

// ==================== 3. LAB TEST REQUESTS & PIPELINE ==================== //

// @desc    Create new lab request (Doctor, Patient, or Admin)
// @route   POST /api/lab/requests
// @access  Private
exports.createLabRequest = async (req, res, next) => {
  try {
    let { patientId, doctorId, testId, priority, clinicalNotes } = req.body;

    if (req.user.role === 'patient') {
      patientId = req.user.id;
    } else if (!patientId) {
      return res.status(400).json({ success: false, message: 'Patient selection is required.' });
    }

    if (req.user.role === 'doctor') {
      doctorId = req.user.id;
    }

    const labTest = await LabTest.findById(testId);
    if (!labTest) {
      return res.status(404).json({ success: false, message: 'Invalid diagnostic test specified.' });
    }

    if (!labTest.isActive) {
      return res.status(400).json({
        success: false,
        message: 'This diagnostic test is currently inactive in the hospital catalog.'
      });
    }

    // Calculate expected turnaround completion date
    const expectedHours = labTest.turnaroundHours || 24;
    const expectedCompletionDate = new Date(Date.now() + expectedHours * 3600 * 1000);

    const request = await LabRequest.create({
      patient: patientId,
      doctor: doctorId || null,
      labTest: testId,
      requestedBy: req.user.id,
      priority: priority || 'Normal',
      sampleType: labTest.sampleType,
      clinicalNotes: clinicalNotes ? clinicalNotes.trim() : '',
      expectedCompletionDate,
      status: 'Requested',
      statusHistory: [
        {
          status: 'Requested',
          updatedBy: req.user.id,
          timestamp: new Date(),
          note: `Test requested by ${req.user.name} (${req.user.role})`
        }
      ]
    });

    await AuditLog.create({
      action: 'LAB_REQUEST_CREATED',
      performedBy: req.user.id,
      role: req.user.role,
      targetEntity: 'LabRequest',
      targetId: request._id.toString(),
      details: {
        testId: labTest._id.toString(),
        testName: labTest.testName,
        patientId,
        priority: request.priority
      }
    });

    const populated = await LabRequest.findById(request._id)
      .populate('labTest')
      .populate('patient', 'name email phone')
      .populate('doctor', 'name email');

    res.status(201).json({
      success: true,
      message: 'Laboratory investigation requested successfully.',
      labRequest: populated
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get lab requests based on role with search, filters, pagination
// @route   GET /api/lab/requests
// @access  Private
exports.getLabRequests = async (req, res, next) => {
  try {
    const {
      status,
      priority,
      search,
      startDate,
      endDate,
      page = 1,
      limit = 15
    } = req.query;

    const query = {};

    // Role-based access control
    if (req.user.role === 'patient') {
      query.patient = req.user.id;
    } else if (req.user.role === 'doctor') {
      query.doctor = req.user.id;
    }

    // Status filter
    if (status && status !== 'All') {
      query.status = status;
    }

    // Priority filter
    if (priority && priority !== 'All') {
      query.priority = priority;
    }

    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    // Search filter across patient names, test names, codes
    if (search && search.trim()) {
      const s = search.trim();
      const matchedUsers = await User.find({
        $or: [
          { name: { $regex: s, $options: 'i' } },
          { email: { $regex: s, $options: 'i' } },
          { phone: { $regex: s, $options: 'i' } }
        ]
      }).select('_id');

      const matchedTests = await LabTest.find({
        $or: [
          { testName: { $regex: s, $options: 'i' } },
          { testCode: { $regex: s, $options: 'i' } }
        ]
      }).select('_id');

      const userIds = matchedUsers.map((u) => u._id);
      const testIds = matchedTests.map((t) => t._id);

      query.$or = [
        { patient: { $in: userIds } },
        { doctor: { $in: userIds } },
        { labTest: { $in: testIds } }
      ];
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 15);
    const skip = (pageNum - 1) * limitNum;

    const total = await LabRequest.countDocuments(query);
    const requests = await LabRequest.find(query)
      .populate('labTest')
      .populate('patient', 'name email phone')
      .populate('doctor', 'name email')
      .populate('assignedStaff', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    res.status(200).json({
      success: true,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      requests
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get detailed single lab request
// @route   GET /api/lab/requests/:id
// @access  Private
exports.getLabRequestById = async (req, res, next) => {
  try {
    const labReq = await LabRequest.findById(req.params.id)
      .populate('labTest')
      .populate('patient', 'name email phone')
      .populate('doctor', 'name email')
      .populate('assignedStaff', 'name email')
      .populate('sampleCollectedBy', 'name email')
      .populate('rejectedBy', 'name email')
      .populate('reviewedBy', 'name email')
      .populate('publishedBy', 'name email')
      .populate('statusHistory.updatedBy', 'name email role');

    if (!labReq) {
      return res.status(404).json({ success: false, message: 'Lab request not found.' });
    }

    // Role-based authorization
    if (req.user.role === 'patient' && labReq.patient._id.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Unauthorized access to this lab request.' });
    }
    if (req.user.role === 'doctor' && labReq.doctor && labReq.doctor._id.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Unauthorized access to this patient request.' });
    }

    res.status(200).json({ success: true, labRequest: labReq });
  } catch (error) {
    next(error);
  }
};

// ==================== 4. SAMPLE COLLECTION & WORKFLOW STATE MACHINE ==================== //

// @desc    Update lab request status through systematic custody chain
// @route   PATCH /api/lab/requests/:id/status
// @access  Private (Lab Staff or Admin)
exports.updateRequestStatus = async (req, res, next) => {
  try {
    const { status, note, rejectionReason, sampleType, sampleNotes } = req.body;

    const validStatuses = [
      'Requested',
      'Accepted',
      'Sample Collected',
      'Processing',
      'Completed',
      'Reviewed',
      'Published',
      'Rejected',
      'Cancelled'
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status "${status}". Allowed values: ${validStatuses.join(', ')}`
      });
    }

    const labReq = await LabRequest.findById(req.params.id).populate('labTest');
    if (!labReq) {
      return res.status(404).json({ success: false, message: 'Lab request not found.' });
    }

    // Enforce valid transitions state machine
    const current = labReq.status;
    const allowedTransitions = {
      Requested: ['Accepted', 'Rejected', 'Cancelled'],
      Accepted: ['Sample Collected', 'Rejected', 'Cancelled'],
      'Sample Collected': ['Processing', 'Rejected', 'Cancelled'],
      Processing: ['Completed', 'Sample Collected', 'Rejected', 'Cancelled'],
      Completed: ['Reviewed', 'Published', 'Processing'],
      Reviewed: ['Published', 'Processing'],
      Published: [], // Released reports cannot directly jump status; requires amendments
      Rejected: ['Requested'], // Admin can reopen if needed
      Cancelled: []
    };

    if (allowedTransitions[current] && !allowedTransitions[current].includes(status) && req.user.role !== 'admin') {
      return res.status(400).json({
        success: false,
        message: `Invalid workflow transition from "${current}" to "${status}".`
      });
    }

    // Specific validation per transition
    if (status === 'Rejected') {
      if (!rejectionReason || !rejectionReason.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Clinical rejection reason is mandatory when rejecting a sample request.'
        });
      }
      labReq.rejectionReason = rejectionReason.trim();
      labReq.rejectedAt = new Date();
      labReq.rejectedBy = req.user.id;
    }

    if (status === 'Sample Collected') {
      labReq.sampleCollectedAt = new Date();
      labReq.sampleCollectedBy = req.user.id;
      if (sampleType && sampleType.trim()) {
        labReq.sampleType = sampleType.trim();
      }
      if (sampleNotes && sampleNotes.trim()) {
        labReq.sampleNotes = sampleNotes.trim();
      }
    }

    if (status === 'Accepted' && !labReq.assignedStaff) {
      labReq.assignedStaff = req.user.id;
    }

    labReq.status = status;
    labReq.statusHistory.push({
      status,
      updatedBy: req.user.id,
      timestamp: new Date(),
      note: note || (status === 'Rejected' ? `Sample rejected: ${rejectionReason}` : `Workflow progressed to ${status}`)
    });

    await labReq.save();

    await AuditLog.create({
      action: `LAB_STATUS_${status.toUpperCase().replace(/\s+/g, '_')}`,
      performedBy: req.user.id,
      role: req.user.role,
      targetEntity: 'LabRequest',
      targetId: labReq._id.toString(),
      details: {
        from: current,
        to: status,
        rejectionReason: status === 'Rejected' ? rejectionReason : undefined
      }
    });

    const populated = await LabRequest.findById(labReq._id)
      .populate('labTest')
      .populate('patient', 'name email phone')
      .populate('doctor', 'name email')
      .populate('assignedStaff', 'name email');

    res.status(200).json({
      success: true,
      message: `Request status transitioned to "${status}".`,
      labRequest: populated
    });
  } catch (error) {
    next(error);
  }
};

// ==================== 5. RESULTS ENTRY, AMENDMENTS & REPORT PUBLISHING ==================== //

// @desc    Record or update test results and submit/publish
// @route   POST /api/lab/results
// @access  Private (Lab Staff or Admin)
exports.recordLabResult = async (req, res, next) => {
  try {
    const { requestId, parameters, remarks, publishNow, amendmentReason } = req.body;

    if (!requestId) {
      return res.status(400).json({ success: false, message: 'Request ID is required.' });
    }

    const labReq = await LabRequest.findById(requestId).populate('labTest');
    if (!labReq) {
      return res.status(404).json({ success: false, message: 'Lab request not found.' });
    }

    let parsedParameters = parameters;
    if (typeof parameters === 'string') {
      try {
        parsedParameters = JSON.parse(parameters);
      } catch (e) {
        return res.status(400).json({ success: false, message: 'Invalid parameters format.' });
      }
    }

    if (!Array.isArray(parsedParameters) || parsedParameters.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one measured test parameter result is required.'
      });
    }

    // Validate parameters
    for (const p of parsedParameters) {
      if (!p.parameterName || p.measuredValue === undefined || p.measuredValue === '') {
        return res.status(400).json({
          success: false,
          message: 'Each parameter must have a valid parameter name and measured value.'
        });
      }
    }

    let result = await LabResult.findOne({ labRequest: requestId });

    // Handle file upload
    let reportFileUrl = '';
    let reportFileName = '';
    let reportFileMimeType = '';
    if (req.file) {
      reportFileUrl = `/uploads/lab-reports/${req.file.filename}`;
      reportFileName = req.file.originalname;
      reportFileMimeType = req.file.mimetype;
    }

    const isPublishing = publishNow === true || publishNow === 'true';

    if (!result) {
      result = new LabResult({
        labRequest: requestId,
        patient: labReq.patient,
        performedBy: req.user.id,
        parameters: parsedParameters,
        remarks: remarks || 'Sample tested following standardized clinical pathology protocols.',
        reportFileUrl: reportFileUrl || '',
        reportFileName: reportFileName || '',
        reportFileMimeType: reportFileMimeType || ''
      });
    } else {
      // If already released, handle auditable amendment
      if (result.publishedAt) {
        if (!amendmentReason || !amendmentReason.trim()) {
          return res.status(400).json({
            success: false,
            message: 'An official amendment reason is mandatory to modify released pathology results.'
          });
        }

        result.amendmentHistory.push({
          amendedAt: new Date(),
          amendedBy: req.user.id,
          reason: amendmentReason.trim(),
          previousParameters: result.parameters,
          previousRemarks: result.remarks
        });
      }

      result.parameters = parsedParameters;
      if (remarks) result.remarks = remarks;
      if (reportFileUrl) {
        result.reportFileUrl = reportFileUrl;
        result.reportFileName = reportFileName;
        result.reportFileMimeType = reportFileMimeType;
      }
    }

    if (isPublishing) {
      result.publishedAt = new Date();
      result.publishedBy = req.user.id;
      labReq.status = 'Published';
      labReq.publishedAt = new Date();
      labReq.publishedBy = req.user.id;
    } else {
      labReq.status = 'Completed';
    }

    labReq.statusHistory.push({
      status: labReq.status,
      updatedBy: req.user.id,
      timestamp: new Date(),
      note: isPublishing
        ? 'Official verified diagnostic report released'
        : 'Bench results recorded; pending final review'
    });

    await result.save();
    await labReq.save();

    await AuditLog.create({
      action: isPublishing ? 'LAB_REPORT_RELEASED' : 'LAB_RESULT_RECORDED',
      performedBy: req.user.id,
      role: req.user.role,
      targetEntity: 'LabResult',
      targetId: result._id.toString(),
      details: {
        requestId,
        parameterCount: parsedParameters.length,
        isAmended: result.amendmentHistory.length > 0,
        published: isPublishing
      }
    });

    res.status(200).json({
      success: true,
      message: isPublishing
        ? 'Official diagnostic report published and released successfully.'
        : 'Test results saved as completed (awaiting review/release).',
      result
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Review and release lab results (Supervisor / Pathologist)
// @route   PATCH /api/lab/results/:requestId/review
// @access  Private (Lab Staff, Admin)
exports.reviewAndReleaseResult = async (req, res, next) => {
  try {
    const { action, notes } = req.body; // action: 'review' | 'release'

    const labReq = await LabRequest.findById(req.params.requestId);
    if (!labReq) {
      return res.status(404).json({ success: false, message: 'Lab request not found.' });
    }

    const result = await LabResult.findOne({ labRequest: req.params.requestId });
    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Cannot review or release: no results have been recorded for this request yet.'
      });
    }

    if (action === 'review') {
      labReq.status = 'Reviewed';
      labReq.reviewedBy = req.user.id;
      labReq.reviewedAt = new Date();
      labReq.reviewNotes = notes || 'Diagnostic results verified and approved by supervising pathologist.';

      result.reviewedBy = req.user.id;
      result.reviewedAt = new Date();

      labReq.statusHistory.push({
        status: 'Reviewed',
        updatedBy: req.user.id,
        timestamp: new Date(),
        note: labReq.reviewNotes
      });

      await AuditLog.create({
        action: 'LAB_REPORT_REVIEWED',
        performedBy: req.user.id,
        role: req.user.role,
        targetEntity: 'LabResult',
        targetId: result._id.toString(),
        details: { requestId: labReq._id.toString(), notes: labReq.reviewNotes }
      });
    } else if (action === 'release') {
      labReq.status = 'Published';
      labReq.publishedBy = req.user.id;
      labReq.publishedAt = new Date();

      result.publishedBy = req.user.id;
      result.publishedAt = new Date();

      labReq.statusHistory.push({
        status: 'Published',
        updatedBy: req.user.id,
        timestamp: new Date(),
        note: 'Diagnostic report released to patient and physician.'
      });

      await AuditLog.create({
        action: 'LAB_REPORT_RELEASED',
        performedBy: req.user.id,
        role: req.user.role,
        targetEntity: 'LabResult',
        targetId: result._id.toString(),
        details: { requestId: labReq._id.toString() }
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid action specified. Must be "review" or "release".'
      });
    }

    await labReq.save();
    await result.save();

    res.status(200).json({
      success: true,
      message: action === 'review' ? 'Diagnostic report reviewed and verified.' : 'Diagnostic report officially released.',
      result,
      labRequest: labReq
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get lab results for a request or patient
// @route   GET /api/lab/results/:requestId
// @access  Private
exports.getLabResult = async (req, res, next) => {
  try {
    const result = await LabResult.findOne({ labRequest: req.params.requestId })
      .populate('performedBy', 'name email role')
      .populate('reviewedBy', 'name email role')
      .populate('publishedBy', 'name email role')
      .populate('amendmentHistory.amendedBy', 'name email')
      .populate({
        path: 'labRequest',
        populate: [
          { path: 'labTest' },
          { path: 'doctor', select: 'name email phone' },
          { path: 'assignedStaff', select: 'name email' }
        ]
      })
      .populate('patient', 'name email phone');

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'No clinical results recorded yet for this request.'
      });
    }

    // Role security check
    if (req.user.role === 'patient') {
      if (result.patient._id.toString() !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Unauthorized access to report.' });
      }
      if (!result.publishedAt) {
        return res.status(403).json({
          success: false,
          message: 'Report is still undergoing clinical laboratory verification and has not been released yet.'
        });
      }
    }

    res.status(200).json({
      success: true,
      result
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Securely download uploaded lab report file
// @route   GET /api/lab/reports/:requestId/download
// @access  Private
exports.downloadReportFile = async (req, res, next) => {
  try {
    const result = await LabResult.findOne({ labRequest: req.params.requestId })
      .populate('patient', 'name')
      .populate('labRequest');

    if (!result) {
      return res.status(404).json({ success: false, message: 'Report record not found.' });
    }

    // Role checks
    if (req.user.role === 'patient') {
      if (result.patient._id.toString() !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Access denied.' });
      }
      if (!result.publishedAt) {
        return res.status(403).json({
          success: false,
          message: 'Report is not yet released for download.'
        });
      }
    }

    if (!result.reportFileUrl) {
      return res.status(404).json({
        success: false,
        message: 'No attached scanned/signed file for this report. Please use the electronic print certificate.'
      });
    }

    // Sanitize path against directory traversal
    const safeFilename = path.basename(result.reportFileUrl);
    const filePath = path.join(__dirname, '../uploads/lab-reports', safeFilename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'Attached report file could not be located on the server.'
      });
    }

    await AuditLog.create({
      action: 'LAB_REPORT_DOWNLOADED',
      performedBy: req.user.id,
      role: req.user.role,
      targetEntity: 'LabResult',
      targetId: result._id.toString(),
      details: { requestId: req.params.requestId }
    });

    const downloadName = result.reportFileName || safeFilename;
    res.download(filePath, downloadName);
  } catch (error) {
    next(error);
  }
};

// @desc    Admin deletes a lab test request
// @route   DELETE /api/lab/requests/:id
// @access  Private/Admin
exports.deleteLabRequest = async (req, res, next) => {
  try {
    const request = await LabRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Lab request order not found.' });
    }

    // Delete associated result and files if any
    await LabResult.deleteMany({ labRequest: req.params.id });
    await LabRequest.findByIdAndDelete(req.params.id);

    await AuditLog.create({
      action: 'ADMIN_DELETED_LAB_REQUEST',
      performedBy: req.user.id,
      role: req.user.role,
      targetEntity: 'LabRequest',
      targetId: req.params.id,
      details: { patientId: String(request.patient), testId: String(request.labTest) }
    });

    res.status(200).json({
      success: true,
      message: 'Lab request order and associated findings deleted successfully.'
    });
  } catch (error) {
    next(error);
  }
};

