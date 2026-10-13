// Stand-in for plaits/user_data.h (which reads the module's flash memory): no user data, so the
// six-operator FM engine plays its built-in patch banks.
#ifndef PLAITS_USER_DATA_H_
#define PLAITS_USER_DATA_H_
#include "stmlib/stmlib.h"
namespace plaits {
class UserData {
 public:
  enum { ADDRESS = 0, SIZE = 0x1000 };
  inline const uint8_t* ptr(int) const { return NULL; }
};
}  // namespace plaits
#endif
