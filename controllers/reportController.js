const User = require('../models/User');
const Appointment = require('../models/Appointment');
const LabRequest = require('../models/LabRequest');
const LabTest = require('../models/LabTest');
const Prescription = require('../models/Prescription');
const AuditLog = require('../models/AuditLog');
const DoctorProfile = require('../models/DoctorProfile');

const Department = require('../models/Department');

// @desc    Get aggregated Admin Dashboard metrics & trends
// @route   GET /api/reports/admin-dashboard
// @access  Private (Admin)
exports.getAdminDashboardStats = async (req, res, next) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [
      totalPatients,
      totalDoctors,
      totalLabStaff,
      totalAdmins,
      totalAppointments,
      todayAppointments,
      pendingAppointments,
      completedAppointments,
      cancelledAppointments,
      pendingLabTests,
      completedLabTests,
      allDoctorProfiles,
      allDepartments,
      recentAppointments
    ] = await Promise.all([
      User.countDocuments({ role: 'patient' }),
      User.countDocuments({ role: 'doctor' }),
      User.countDocuments({ role: 'lab' }),
      User.countDocuments({ role: 'admin' }),
      Appointment.countDocuments(),
      Appointment.countDocuments({ appointmentDate: { $gte: todayStart, $lte: todayEnd } }),
      Appointment.countDocuments({ status: { $in: ['Pending', 'Confirmed'] } }),
      Appointment.countDocuments({ status: 'Completed' }),
      Appointment.countDocuments({ status: { $in: ['Cancelled', 'Rejected'] } }),
      LabRequest.countDocuments({ status: { $in: ['Requested', 'Accepted', 'Sample Collected', 'Processing'] } }),
      LabRequest.countDocuments({ status: { $in: ['Completed', 'Published', 'Reviewed'] } }),
      DoctorProfile.find().populate('user', 'name status'),
      Department.find({ status: 'active' }),
      Appointment.find()
        .populate('doctor', 'name')
        .populate('patient', 'name')
        .sort({ createdAt: -1 })
        .limit(8)
    ]);

    // ==================== 1. DAILY 7-DAY TREND ==================== //
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

      // Compare across both appointmentDate and createdAt
      const [apptCount, compCount] = await Promise.all([
        Appointment.countDocuments({
          $or: [
            { appointmentDate: { $gte: startOfDay, $lte: endOfDay } },
            { createdAt: { $gte: startOfDay, $lte: endOfDay } }
          ]
        }),
        Appointment.countDocuments({
          status: 'Completed',
          updatedAt: { $gte: startOfDay, $lte: endOfDay }
        })
      ]);

      weekTotal += apptCount;

      daysTrend.push({
        day: dayName,
        date: startOfDay.toISOString().split('T')[0],
        appointments: apptCount,
        completed: compCount
      });
    }

    // Previous 7 days total for badge calculation
    const prevWeekStart = new Date();
    prevWeekStart.setDate(now.getDate() - 13);
    prevWeekStart.setHours(0, 0, 0, 0);
    const prevWeekEnd = new Date();
    prevWeekEnd.setDate(now.getDate() - 7);
    prevWeekEnd.setHours(23, 59, 59, 999);

    prevWeekTotal = await Appointment.countDocuments({
      createdAt: { $gte: prevWeekStart, $lte: prevWeekEnd }
    });

    let badgeText = 'Live Sync Active';
    let badgePositive = true;
    if (weekTotal > prevWeekTotal && prevWeekTotal > 0) {
      const pct = Math.round(((weekTotal - prevWeekTotal) / prevWeekTotal) * 100);
      badgeText = `+${pct}% High Inflow`;
      badgePositive = true;
    } else if (weekTotal < prevWeekTotal && prevWeekTotal > 0) {
      const pct = Math.round(((prevWeekTotal - weekTotal) / prevWeekTotal) * 100);
      badgeText = `-${pct}% Patient Load`;
      badgePositive = false;
    }

    // ==================== 2. MONTHLY 6-MONTH ROLLING TIMELINE ==================== //
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyIntake = [];
    const monthlyAttendance = [];

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = d.getMonth();
      const label = monthNames[month];

      const startOfMonth = new Date(year, month, 1, 0, 0, 0, 0);
      const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);

      const [mAppts, mCompleted, mLabs] = await Promise.all([
        Appointment.countDocuments({
          $or: [
            { appointmentDate: { $gte: startOfMonth, $lte: endOfMonth } },
            { createdAt: { $gte: startOfMonth, $lte: endOfMonth } }
          ]
        }),
        Appointment.countDocuments({
          status: 'Completed',
          appointmentDate: { $gte: startOfMonth, $lte: endOfMonth }
        }),
        LabRequest.countDocuments({
          createdAt: { $gte: startOfMonth, $lte: endOfMonth }
        })
      ]);

      monthlyIntake.push({
        label,
        encounters: mAppts + mLabs,
        appointments: mAppts,
        completed: mCompleted,
        labs: mLabs
      });

      monthlyAttendance.push({
        label,
        val1: mAppts,
        val2: mCompleted
      });
    }

    // ==================== 3. DEPARTMENT WORKLOAD DISTRIBUTION ==================== //
    const apptsByDoctor = await Appointment.aggregate([
      {
        $group: {
          _id: '$doctor',
          total: { $sum: 1 },
          completed: {
            $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] }
          }
        }
      }
    ]);

    const deptAgg = {};
    allDepartments.forEach((d) => {
      deptAgg[d.name] = { scheduled: 0, completed: 0 };
    });

    allDoctorProfiles.forEach((dp) => {
      const dept = dp.department || dp.specialization || 'General OPD';
      if (!deptAgg[dept]) {
        deptAgg[dept] = { scheduled: 0, completed: 0 };
      }
    });

    apptsByDoctor.forEach((item) => {
      const docIdStr = item._id ? item._id.toString() : '';
      const dp = allDoctorProfiles.find((p) => p.user && p.user._id.toString() === docIdStr);
      const dept = dp ? dp.department || dp.specialization : 'General OPD';
      if (!deptAgg[dept]) {
        deptAgg[dept] = { scheduled: 0, completed: 0 };
      }
      deptAgg[dept].scheduled += item.total;
      deptAgg[dept].completed += item.completed;
    });

    const palette = ['#10B981', '#0E9FAD', '#6366F1', '#F59E0B', '#EC4899', '#8B5CF6', '#14B8A6', '#F43F5E'];

    const departmentMix = Object.keys(deptAgg).map((dept, i) => ({
      label: dept,
      value: deptAgg[dept].scheduled,
      color: palette[i % palette.length]
    }));

    const departmentThroughput = Object.keys(deptAgg).map((dept) => ({
      label: dept.length > 9 ? dept.substring(0, 8) + '…' : dept,
      fullName: dept,
      val1: deptAgg[dept].scheduled,
      val2: deptAgg[dept].completed
    }));

    // ==================== 4. APPOINTMENT STATUS RATIO ==================== //
    const confirmedAppts = await Appointment.countDocuments({ status: { $in: ['Confirmed', 'In Progress'] } });
    const appointmentStatusMix = [
      { label: 'Completed Visits', value: completedAppointments, color: '#10B981' },
      { label: 'Confirmed / Active', value: confirmedAppts, color: '#0E9FAD' },
      { label: 'Pending Approval', value: pendingAppointments, color: '#F59E0B' },
      { label: 'Cancelled / Rejected', value: cancelledAppointments, color: '#F43F5E' }
    ];

    // ==================== 5. LAB REQUISITIONS STATUS ==================== //
    const processingLabs = await LabRequest.countDocuments({
      status: { $in: ['Processing', 'Sample Collected', 'Accepted'] }
    });
    const pendingLabs = await LabRequest.countDocuments({ status: 'Requested' });
    const cancelledLabs = await LabRequest.countDocuments({ status: { $in: ['Cancelled', 'Rejected'] } });

    const labStatusMix = [
      { label: 'Published / Ready', value: completedLabTests, color: '#10B981' },
      { label: 'Specimen Processing', value: processingLabs, color: '#0E9FAD' },
      { label: 'Pending Order', value: pendingLabs, color: '#F59E0B' },
      { label: 'Cancelled', value: cancelledLabs, color: '#F43F5E' }
    ];

    // ==================== 6. USER DEMOGRAPHICS ==================== //
    const userDemographics = [
      { label: 'Registered Patients', value: totalPatients, color: '#10B981' },
      { label: 'Attending Doctors', value: totalDoctors, color: '#0E9FAD' },
      { label: 'Laboratory Staff', value: totalLabStaff, color: '#8B5CF6' },
      { label: 'Administrators', value: totalAdmins, color: '#F59E0B' }
    ];

    res.status(200).json({
      success: true,
      stats: {
        totalPatients,
        totalDoctors,
        totalLabStaff,
        totalAdmins,
        totalAppointments,
        todayAppointments,
        pendingAppointments,
        completedAppointments,
        cancelledAppointments,
        pendingLabTests,
        completedLabTests
      },
      charts: {
        daysTrend,
        badgeText,
        badgePositive,
        monthlyIntake,
        monthlyAttendance,
        departmentMix,
        departmentThroughput,
        appointmentStatusMix,
        labStatusMix,
        userDemographics
      },
      recentAppointments
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Generate filtered report data
// @route   GET /api/reports/summary
// @access  Private (Admin)
exports.getReportsSummary = async (req, res, next) => {
  try {
    const { startDate, endDate, reportType } = req.query;

    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999))
      };
    }

    let reportData = {};

    if (reportType === 'appointments' || !reportType) {
      reportData.appointments = await Appointment.find(dateFilter)
        .populate('doctor', 'name')
        .populate('patient', 'name phone')
        .sort({ appointmentDate: -1 });
    }

    if (reportType === 'lab' || !reportType) {
      reportData.labRequests = await LabRequest.find(dateFilter)
        .populate('labTest')
        .populate('patient', 'name')
        .populate('doctor', 'name')
        .sort({ createdAt: -1 });
    }

    if (reportType === 'patients' || !reportType) {
      reportData.patients = await User.find({ role: 'patient', ...dateFilter })
        .select('-password')
        .sort({ createdAt: -1 });
    }

    res.status(200).json({
      success: true,
      data: reportData
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get paginated audit logs with action & role filtering
// @route   GET /api/reports/audit-logs
// @access  Private (Admin)
exports.getAuditLogs = async (req, res, next) => {
  try {
    const { action, role, page = 1, limit = 20 } = req.query;

    const query = {};
    if (action && action !== 'all') {
      query.action = action;
    }
    if (role && role !== 'all') {
      query.role = role;
    }

    const skip = (Number(page) - 1) * Number(limit);
    const total = await AuditLog.countDocuments(query);
    const logs = await AuditLog.find(query)
      .populate('performedBy', 'name email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      logs
    });
  } catch (error) {
    next(error);
  }
};
