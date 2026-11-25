/**
 * Shared authorization helpers for Knowledge Bases and Documents.
 * Enforces visibility boundaries ('private', 'department', 'organization'),
 * document-level 'restricted' guards, organization isolation, and admin privileges.
 */

export const canUserModifyKB = (user, kb) => {
  if (!user || !kb) return false;
  if (kb.organization && user.organization && kb.organization !== user.organization) {
    return false;
  }
  if (user.role === 'admin') return true;
  const ownerId = kb.owner?._id ? kb.owner._id.toString() : kb.owner?.toString();
  return Boolean(ownerId && ownerId === user._id.toString());
};

export const canUserViewKB = (user, kb) => {
  if (!user || !kb) return false;

  // Enforce organization boundary when both user and KB carry an organization identifier
  if (kb.organization && user.organization && kb.organization !== user.organization) {
    return false;
  }

  if (user.role === 'admin') return true;

  const ownerId = kb.owner?._id ? kb.owner._id.toString() : kb.owner?.toString();
  if (ownerId && ownerId === user._id.toString()) return true;

  if (kb.visibility === 'organization') return true;

  if (kb.visibility === 'department' && user.department && kb.department === user.department) {
    return true;
  }

  return false;
};

export const canUserReadDocument = (user, doc, kb) => {
  if (!user || !doc || !kb) return false;
  if (!canUserViewKB(user, kb)) return false;

  if (user.role === 'admin') return true;

  const uploaderId = doc.uploadedBy?._id
    ? doc.uploadedBy._id.toString()
    : doc.uploadedBy?.toString();
  const kbOwnerId = kb.owner?._id ? kb.owner._id.toString() : kb.owner?.toString();
  const userIdStr = user._id.toString();

  if (uploaderId === userIdStr || kbOwnerId === userIdStr) {
    return true;
  }

  if (doc.visibility === 'restricted') {
    return false;
  }

  if (doc.department && kb.visibility !== 'organization' && doc.department !== user.department) {
    return false;
  }

  return true;
};

export const canUserDeleteDocument = (user, doc, kb) => {
  if (!user || !doc) return false;
  if (kb && kb.organization && user.organization && kb.organization !== user.organization) {
    return false;
  }
  if (user.role === 'admin') return true;

  const uploaderId = doc.uploadedBy?._id
    ? doc.uploadedBy._id.toString()
    : doc.uploadedBy?.toString();
  const kbOwnerId = kb?.owner?._id ? kb.owner._id.toString() : kb?.owner?.toString();
  const userIdStr = user._id.toString();

  return uploaderId === userIdStr || (Boolean(kbOwnerId) && kbOwnerId === userIdStr);
};
