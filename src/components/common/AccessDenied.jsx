import { Lock } from 'lucide-react';
import { ROLES } from '../../constants/auth.js';

export const AccessDenied = ({ currentUser, page }) => {
  const role = ROLES[currentUser.role];
  return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 rounded-full bg-[#E74C6F]/20 flex items-center justify-center mx-auto mb-4">
          <Lock size={24} className="text-[#E74C6F]"/>
        </div>
        <div className="text-lg font-semibold">Access Restricted</div>
        <div className="text-[13px] text-[#8a95a3] mt-2">
          Your role (<span className="font-mono text-[#e8ecef]">{role.label}</span>) does not have permission to view this page.
        </div>
        <div className="text-[12px] text-[#5d6b7a] mt-1">
          Contact your administrator if you need access.
        </div>
      </div>
    </div>
  );
};
