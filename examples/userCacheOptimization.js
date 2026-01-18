/**
 * Example: How to optimize your code with UserCacheService
 * This shows before/after comparisons for common operations
 */

const UserCacheService = require('../services/userCacheService');
const User = require('../models/userModel');

// ============================================================================
// EXAMPLE 1: Message Handling (Most Common Operation)
// ============================================================================

// ❌ BEFORE - Slow (3 database queries per message)
async function handleMessage_SLOW(chatId, partnerId, msg) {
  const sender = await User.findOne({ where: { userId: chatId } });
  const receiver = await User.findOne({ where: { userId: partnerId } });
  
  if (sender.banned || receiver.banned) {
    return false;
  }
  
  // Process message...
  return true;
}

// ✅ AFTER - Fast (0-1 database queries, uses cache)
async function handleMessage_FAST(chatId, partnerId, msg) {
  // Batch get both users from cache
  const [sender, receiver] = await UserCacheService.getUser(
    [chatId, partnerId], 
    ['userId', 'banned']  // Only fetch what we need
  );
  
  if (!sender || !receiver || sender.banned || receiver.banned) {
    return false;
  }
  
  // Process message...
  return true;
}

// ============================================================================
// EXAMPLE 2: Partner Lookup
// ============================================================================

// ❌ BEFORE - Slow (1 Redis query + 1 DB query)
async function getPartnerInfo_SLOW(chatId) {
  const { redisClient } = require('../database/redisClient');
  const partnerId = await redisClient.get("pair:" + chatId);
  
  if (!partnerId) return null;
  
  const partner = await User.findOne({ 
    where: { userId: partnerId },
    attributes: ['userId', 'gender', 'name']
  });
  
  return partner;
}

// ✅ AFTER - Fast (1 Redis query, DB cached)
async function getPartnerInfo_FAST(chatId) {
  const partnerId = await UserCacheService.getPartnerId(chatId);
  
  if (!partnerId) return null;
  
  const partner = await UserCacheService.getUser(
    partnerId,
    ['userId', 'gender', 'name']
  );
  
  return partner;
}

// ============================================================================
// EXAMPLE 3: Admin Media Forwarding
// ============================================================================

// ❌ BEFORE - Slow (2 DB queries)
async function forwardMediaToAdmin_SLOW(senderId, receiverId, mediaMsg) {
  const sender = await User.findOne({ where: { userId: senderId } });
  const receiver = await User.findOne({ where: { userId: receiverId } });
  
  const caption = `From: ${sender?.name || 'Unknown'} (${sender?.gender || '?'})\n` +
                  `To: ${receiver?.name || 'Unknown'} (${receiver?.gender || '?'})`;
  
  // Forward with caption...
}

// ✅ AFTER - Fast (0-1 DB query with cache)
async function forwardMediaToAdmin_FAST(senderId, receiverId, mediaMsg) {
  const [sender, receiver] = await UserCacheService.getUser(
    [senderId, receiverId],
    ['name', 'gender']
  );
  
  const caption = `From: ${sender?.name || 'Unknown'} (${sender?.gender || '?'})\n` +
                  `To: ${receiver?.name || 'Unknown'} (${receiver?.gender || '?'})`;
  
  // Forward with caption...
}

// ============================================================================
// EXAMPLE 4: Batch Operations (Matching/Queue Management)
// ============================================================================

// ❌ BEFORE - Very Slow (N database queries in loop)
async function getQueuedUsers_SLOW(userIds) {
  const users = [];
  for (const userId of userIds) {
    const user = await User.findOne({ where: { userId } });
    if (user && !user.banned) users.push(user);
  }
  return users;
}

// ✅ AFTER - Fast (1 batched operation)
async function getQueuedUsers_FAST(userIds) {
  const users = await UserCacheService.getUser(userIds, ['userId', 'banned', 'gender']);
  return users.filter(u => u && !u.banned);
}

// ============================================================================
// EXAMPLE 5: Update User Data (Important: Invalidate Cache!)
// ============================================================================

// ❌ BEFORE - Cache becomes stale
async function updateUserGender_WRONG(userId, newGender) {
  await User.update({ gender: newGender }, { where: { userId } });
  // Cache still has old data! ❌
}

// ✅ AFTER - Properly invalidate cache
async function updateUserGender_CORRECT(userId, newGender) {
  await User.update({ gender: newGender }, { where: { userId } });
  
  // Invalidate cache so next read gets fresh data
  await UserCacheService.invalidate(userId);
}

// ============================================================================
// PERFORMANCE COMPARISON
// ============================================================================

async function performanceTest() {
  console.log('Testing 100 message operations...\n');
  
  const testUserIds = Array.from({ length: 100 }, (_, i) => 1000 + i);
  const testPairs = testUserIds.map((id, i) => [id, id + 100]);
  
  // Test OLD way
  console.time('❌ OLD (No Cache)');
  for (const [sender, receiver] of testPairs.slice(0, 10)) {
    await handleMessage_SLOW(sender, receiver, {});
  }
  console.timeEnd('❌ OLD (No Cache)');
  
  // Test NEW way
  console.time('✅ NEW (With Cache)');
  for (const [sender, receiver] of testPairs.slice(0, 10)) {
    await handleMessage_FAST(sender, receiver, {});
  }
  console.timeEnd('✅ NEW (With Cache)');
  
  console.log('\n📊 Expected Results:');
  console.log('  OLD: ~1000-2000ms (100-200ms per operation)');
  console.log('  NEW: ~100-300ms (10-30ms per operation)');
  console.log('  Improvement: 5-10x faster! 🚀');
}

// ============================================================================
// HOW TO MIGRATE YOUR CODE
// ============================================================================

/*
 * STEP 1: Find all User.findOne() calls in your code
 * 
 * grep -r "User.findOne" controllers/ services/
 * 
 * STEP 2: Replace with UserCacheService.getUser()
 * 
 * OLD: const user = await User.findOne({ where: { userId } });
 * NEW: const user = await UserCacheService.getUser(userId);
 * 
 * STEP 3: For multiple users, use batch operation
 * 
 * OLD: 
 *   const user1 = await User.findOne({ where: { userId: id1 } });
 *   const user2 = await User.findOne({ where: { userId: id2 } });
 * 
 * NEW:
 *   const [user1, user2] = await UserCacheService.getUser([id1, id2]);
 * 
 * STEP 4: When updating users, invalidate cache
 * 
 * await User.update({ ... }, { where: { userId } });
 * await UserCacheService.invalidate(userId);  // ← Add this!
 * 
 */

module.exports = {
  performanceTest,
  // Export optimized functions for reference
  handleMessage_FAST,
  getPartnerInfo_FAST,
  forwardMediaToAdmin_FAST,
  getQueuedUsers_FAST
};
